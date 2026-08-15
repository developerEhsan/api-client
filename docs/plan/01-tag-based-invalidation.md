# 01 — Tag-based cache invalidation

## Problem

Two real complaints map to the same root cause:

1. **SSR apps see stale GET data after an update/delete.** A GET response is
   cached under a key derived from `method + url + tenant + authFingerprint`
   (`computeCacheKey`, `packages/core/src/utilities/cache.ts:119-128`).
   Nothing links that cached entry to the mutation that made it stale. The
   only invalidation tool today is `client.cache.invalidate(globPattern)`
   (`createClient.ts:1195-1202`), which requires the developer to know and
   hand-write the exact key shape — error-prone, and nothing enforces it gets
   called at all.
2. **Same VM, two different users, one stale.** An admin fetches user 123
   (cached under a key scoped to the admin's `authFingerprint`) and a
   regular user also fetches user 123 (cached under a **different** key,
   scoped to their own `authFingerprint` — this is intentional, see
   `store.types.ts:7-10`, cross-tenant isolation). When the admin updates
   user 123 and invalidates, only the admin's key is known to whoever wrote
   that invalidate call. The other user's differently-scoped key is
   untouched — stale data persists for them, on the very same process.

Both are solved by the same mechanism: **let a cached entry be tagged with
one or more logical labels, and let a mutation declare which labels it
invalidates.** The tag-to-key lookup is global (per-process), independent of
which auth scope owns each key, so one `invalidatesTags` on a mutation clears
every scoped copy in one pass — no Redis, no cross-instance machinery
required for this part (that's file `02`).

## Current state (reference)

- `CacheConfig` — `packages/core/src/types/cache.types.ts:54-99`.
- `CacheEntry` — `cache.types.ts:23-36`.
- `CacheStore` interface + `createCache()` — `packages/core/src/utilities/cache.ts:12-102`. LRU Map, `invalidate(pattern)` does glob-to-regex over keys only.
- Cache read/write in the pipeline — `packages/core/src/factory/createClient.ts:710-804` (`cacheEligible`, `cacheKey`, `fetchThrough`, `produce`).
- `client.cache` public surface — `createClient.ts:1195-1202` (`invalidate`, `clear`, `get`).
- Per-call config — `PerCallConfig.cache` — `types/config.types.ts:640-645` (currently `{ enabled?, ttl?, bust? }`).
- Method definitions flow through `factory/createModuleProxy.ts` and `factory/createTypedClient.ts` (per-method config passthrough, see `CLAUDE.md`).

## Design

### 1. Extend `CacheEntry` and `CacheConfig` with tags

```ts
// cache.types.ts
export interface CacheEntry<T = unknown> {
  key: CacheKey;
  data: T;
  status: number;
  headers: Record<string, string>;
  storedAt: number;
  expiresAt: number;
  /** Logical labels this entry is filed under, for tag-based invalidation. */
  tags?: string[]; // NEW
}
```

`CacheConfig` itself doesn't need a `tags` field — tags are a **per-method**
concern (what does *this* endpoint's response represent), not a global/module
default. They belong on `PerCallConfig` and, more importantly, on the method
descriptor so codegen'd and hand-defined methods can declare them once,
not on every call site.

### 2. New per-method descriptor fields

Wherever a method is described today (generated `api.modules.ts` descriptors,
`defineModule`/`createModuleDefiner` custom methods — see `factory/createModuleProxy.ts`),
add two optional fields:

```ts
/**
 * Passed as the third argument to `invalidatesTags`/`cacheTags` — gives the
 * callback enough context to make an informed decision without having to
 * re-derive scoping information the pipeline already resolved.
 */
interface CacheCallbackContext {
  tenantId?: string;
  authFingerprint?: string;
  /** The fully-resolved config for this call (global -> module -> per-call merge). */
  resolvedConfig: Readonly<ResolvedRequestConfig>;
}

interface MethodDescriptor {
  // ...existing fields (method, path, etc.)
  /**
   * Tags this response is cached under. Static list, or computed from the
   * resolved request args/path params (e.g. the resource id).
   */
  cacheTags?: (args: unknown, ctx: CacheCallbackContext) => string[];
  /**
   * On success, tags to invalidate across the WHOLE process (all auth
   * scopes). Receives the mutation's own response body as `result` so the
   * invalidation set can depend on server-returned data (e.g. a bulk-update
   * endpoint that returns the list of affected ids), not just the request
   * args. Return as many tags as needed — this already supports invalidating
   * multiple tags per call; there's no separate "multi-tag" mode.
   */
  invalidatesTags?: (args: unknown, result: unknown, ctx: CacheCallbackContext) => string[];
}
```

Both are plain functions so a single descriptor works for parameterized
resources: `cacheTags: (args) => ['user:' + args.userId]`. Because
`invalidatesTags` already returns `string[]`, a bulk mutation naturally
invalidates several tags in one call —
`invalidatesTags: (args, result) => result.affectedIds.map((id) => \`user:${id}\`)`
clears N tags from a single response, no separate multi-tag API needed.

Also add the one-off escape hatch on `PerCallConfig` for ad-hoc cases that
don't want a descriptor-level declaration:

```ts
// config.types.ts — PerCallConfig.cache
cache?: {
  enabled?: boolean;
  ttl?: number;
  bust?: boolean;
  tags?: string[];              // NEW — tags this specific call's cache entry
  invalidatesTags?: string[];   // NEW — tags to clear after this specific call succeeds
};
```

Per-call values and descriptor-level values **compose** (union), they don't
override — a call can add extra tags beyond what its descriptor declares.

### 3. Global tag index

New module `packages/core/src/utilities/tagIndex.ts`:

```ts
export interface TagIndex {
  /** Record that `key` is filed under `tags`. */
  track(key: string, tags: string[]): void;
  /** Stop tracking `key` (call on delete/evict so the index doesn't leak). */
  untrack(key: string): void;
  /** Return every key currently filed under any of `tags`. */
  keysFor(tags: string[]): Set<string>;
  clear(): void;
}

export function createTagIndex(): TagIndex {
  const tagToKeys = new Map<string, Set<string>>();
  const keyToTags = new Map<string, Set<string>>();
  // track: for each tag, add key to tagToKeys.get(tag); record reverse in keyToTags
  // untrack: look up keyToTags.get(key), remove key from each tagToKeys set, delete keyToTags[key]
  // keysFor: union of tagToKeys.get(tag) for each requested tag
  // ...
}
```

This is **pure, synchronous, in-memory, per-process** — exactly the scope
needed to fix problem 2 (two users, one VM). It must NOT be scoped by
tenant/authFingerprint: the whole point is that one tag reaches every scoped
copy. This is safe because the index only ever maps to opaque cache *keys*,
never exposes the cached *data* across scopes — a lookup by tag still only
ever deletes; it never lets one scope's request read another scope's entry.

### 4. Wire into the pipeline (`createClient.ts`)

- Instantiate one `tagIndex = createTagIndex()` alongside `cacheStore`
  (~line 330-338, where `l1Cache` is built).
- In `fetchThrough` (currently `createClient.ts:744-761`), after
  `cacheStore.set(cacheKey, entry)`, also call
  `tagIndex.track(cacheKey, resolvedCacheTags)` when `resolvedCacheTags.length > 0`.
- In `createCache()`'s eviction path (`utilities/cache.ts:44-53`) and in
  `cacheStore.delete`/`clear`, the tag index must be kept in sync —
  cleanest way: wrap `cacheStore` with a small decorator that calls
  `tagIndex.untrack(key)` on every delete/evict, rather than modifying
  `createCache()` itself (keeps `utilities/cache.ts` dependency-free per its
  existing "pure and IO-free" doc comment at the top of the file).
- After a **mutation** method succeeds (non-GET, so this is a new branch
  alongside the existing GET-only cache logic at `createClient.ts:686-689`),
  resolve `invalidatesTags` (descriptor + per-call union) and if non-empty:
  ```ts
  const keys = tagIndex.keysFor(resolvedInvalidatesTags);
  for (const key of keys) cacheStore.delete(key); // also untracks via the decorator above
  ```
  This must run **regardless of which auth scope's key** each entry was
  stored under — that's the fix for problem 2.

### 5. Public API addition — structured result, not a bare count

Expose tag invalidation on `client.cache` alongside the existing methods
(`createClient.ts:1195-1202`). Return a small structured object instead of a
bare number — "how many were removed" is rarely the only thing a caller
wants; knowing *which* keys/tags were actually affected (e.g. for logging,
or to confirm a specific expected entry was really cleared) is the more
useful shape and costs nothing extra to compute since the pipeline already
has the key set in hand:

```ts
interface InvalidationResult {
  removedCount: number;
  removedKeys: string[];
  /** Echoes the tags/pattern that were matched against, for logging/debugging. */
  matchedOn: { tags?: string[]; pattern?: string };
}

interface ClientCache {
  /** Existing glob-based invalidation — return type upgraded from `void` to `InvalidationResult`. */
  invalidate(pattern?: string): InvalidationResult;
  /** NEW — invalidate by one or more tags in a single call. */
  invalidateTags(tags: string[]): InvalidationResult;
  clear(): void;                            // existing, unchanged (clearing everything needs no report)
  get(key: string): CacheEntry | undefined; // existing
}
```

`invalidate`'s return type moves from `void` to `InvalidationResult` — safe
in practice (constraint #7 in the plan README still holds: no caller today
can be relying on a `void`-typed return value for behavior, since there was
nothing to read). Flag this explicitly in the changeset as a type-only
signature change so consumers pinning strict `void`-returning function types
in their own wrapper code aren't surprised.

This lets a developer manually trigger invalidation outside the
descriptor/mutation flow too (e.g. from a webhook handler), and log/assert
on exactly what happened:

```ts
const result = api.cache.invalidateTags(['user:123', 'dashboard:sales']);
console.log(`cleared ${result.removedCount} entries:`, result.removedKeys);
```

## Example end-state usage

```ts
// codegen or defineModule descriptor
users: {
  getUser: {
    method: 'GET', path: '/users/:id',
    cacheTags: (args) => [`user:${args.id}`],
  },
  updateUser: {
    method: 'PATCH', path: '/users/:id',
    invalidatesTags: (args) => [`user:${args.id}`],
  },
}

// admin updates user 123 — clears EVERY cached copy of user:123,
// regardless of which user's auth scope cached it
await api.users.updateUser({ id: '123' }, patch);

// ad-hoc, no descriptor support needed
await api.reports.refreshDashboard(undefined, {
  cache: { invalidatesTags: ['dashboard:sales'] },
});
```

## Security constraints specific to this file

- Tag strings are developer-supplied labels, not user input in the common
  case — but if a tag is ever derived from unsanitized request args (e.g.
  `args.id` where `id` is user-controlled), that's fine: tags only ever key
  into the *invalidation* side, they never gate *read access* to cached data.
  Worst case of a malicious tag value is an unnecessary cache eviction (a
  minor availability nit), never a cross-scope data read. Document this
  explicitly in the `cacheTags`/`invalidatesTags` JSDoc so nobody assumes
  tags need input sanitization for confidentiality reasons.
- Do not let `invalidateTags`/`invalidatesTags` accept a pattern/glob by
  accident (e.g. don't reuse `globToRegExp` here) — tags must be **exact
  string matches** in the index. Mixing glob semantics into tags reintroduces
  the "accidentally wipe more than intended" risk file `08`'s dry-run feature
  is meant to mitigate for the *pattern*-based `invalidate()`, and tags
  should stay simple and predictable instead.

## Tests to add

`packages/core/src/utilities/tagIndex.test.ts`:
- track/untrack/keysFor basic correctness, including a key tagged with
  multiple tags and a tag shared by multiple keys.
- untrack after track leaves no dangling references (memory leak check —
  assert internal maps are empty after untracking every key).

`packages/core/src/factory/createClient.test.ts` (extend existing suite):
- Two different auth scopes GET the same resource, mutation from one scope
  invalidates by tag, assert **both** scoped cache entries are gone (this is
  the regression test for problem 2 specifically — same-VM, two users).
- Mutation with `invalidatesTags` clears only entries carrying that tag, not
  unrelated cached entries (no over-invalidation).
- Descriptor-level `cacheTags` and per-call `cache.tags` both contribute to
  the same entry's tag set (union, not override).
- Eviction (LRU overflow) of a tagged entry removes it from the tag index too
  (no stale index entries pointing at a key `cacheStore.get` no longer has).
- `invalidateTags(['a', 'b'])` against entries tagged only `a`, only `b`, both,
  and neither — assert `removedKeys`/`removedCount` matches exactly the
  union, and `matchedOn.tags` echoes `['a', 'b']`.
- `invalidatesTags` receives the mutation's response body as `result` and a
  `ctx` with `tenantId`/`authFingerprint`/`resolvedConfig` populated —
  construct a descriptor that computes tags from `result.affectedIds` and
  assert every one of several bulk-affected entries is cleared from one call.

## Docs to update after shipping

`docs/caching.md`, `docs/multi-tenancy.md` (the two-user scenario is
fundamentally a multi-tenancy/multi-identity concern worth cross-linking).
