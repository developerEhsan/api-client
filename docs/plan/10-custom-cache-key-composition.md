# 10 — Custom cache key composition

## Problem

Today there are exactly two ways to influence a cache key:

1. Do nothing — `computeCacheKey` derives it from
   `method + url + tenantId + authFingerprint`
   (`packages/core/src/utilities/cache.ts:119-128`).
2. Supply `keyResolver: (request: ApiRequest) => string`
   (`CacheConfig.keyResolver`, `cache.types.ts:76-86`) — a **full override**
   that replaces the built-in derivation entirely.

Option 2 is unsafe for the common real case: a developer wants to *add* one
extra dimension to the key (e.g. "this dashboard endpoint's response depends
on which target user/workspace/date-range was selected, not just who's
asking"), but writing a `keyResolver` means reimplementing
tenant/auth-fingerprint scoping by hand — easy to get wrong, and a wrong
implementation silently reintroduces the exact cross-tenant leak
`computeCacheKey`'s scoping exists to prevent (`store.types.ts:7-10`).

Concretely, the scenario described: a dashboard endpoint like
`GET /dashboard/summary` is the same URL for every viewer, but an admin
viewing "as" a specific target user, or a multi-workspace app where the
active workspace is carried in a header/param rather than the URL path,
means two requests with an identical `method + url` legitimately need
different cache entries — something the default key can't distinguish and
`keyResolver` can only fix by throwing away the existing safety net.

## Current state (reference)

- `computeCacheKey` — `utilities/cache.ts:119-128`:
  ```ts
  export function computeCacheKey(input: {
    method: string; url: string; tenantId?: string; authFingerprint?: string;
  }): string {
    const prefix = `${input.method.toUpperCase()}:${input.url}`;
    const scope = `${input.tenantId ?? ''}|${input.authFingerprint ?? ''}`;
    return `${prefix}#${hash(scope)}`;
  }
  ```
- `CacheConfig.keyResolver` — `cache.types.ts:76-86` — full override, receives
  only the raw `ApiRequest`, has no access to `tenantId`/`authFingerprint`
  the pipeline already resolved (it would have to be re-derived, awkwardly).
- Call site — `createClient.ts:732-740`:
  ```ts
  cacheKey = computeCacheKey({
    method, url: identityUrl,
    ...(tenantId !== undefined ? { tenantId } : {}),
    ...(fp !== null ? { authFingerprint: fp } : {}),
  });
  ```
  (`keyResolver`, if the current code even wires it in here — verify at
  implementation time whether `keyResolver` is actually consumed at this
  call site today or only declared in the type; if unwired, that's a
  pre-existing gap to fix as part of this same change, not a new one to
  introduce.)

## Design

### Add a composable `cacheKeyParts` alongside (not instead of) `keyResolver`

```ts
// cache.types.ts — CacheConfig
export interface CacheConfig {
  // ...existing fields
  keyResolver?: (request: ApiRequest) => string; // existing — full override, unsafe, kept for escape-hatch cases
  /**
   * Extra key dimensions merged INTO the default (or `keyResolver`'s) key —
   * safer than `keyResolver` for the common case of "add one more thing to
   * the scope" without losing tenant/auth-fingerprint isolation. Return a
   * plain object of string values; every value is folded into the same
   * hash `computeCacheKey` already applies to tenant/authFingerprint, so
   * cross-scope isolation is preserved automatically — you're extending the
   * scope, not replacing the scoping mechanism.
   * @default optional, unset means no extra key parts
   */
  cacheKeyParts?: (args: unknown, ctx: { tenantId?: string; authFingerprint?: string }) => Record<string, string>;
}
```

This can be set at global, module, or per-call/per-method-descriptor level,
following the same layering the rest of `CacheConfig` already uses
(`ModuleConfig.cache?: Partial<CacheConfig>`, `PerCallConfig.cache`). At the
descriptor level it's the natural fit for the dashboard scenario:

```ts
dashboard: {
  getSummary: {
    method: 'GET', path: '/dashboard/summary',
    cacheTags: (args) => [`dashboard:${args.workspaceId}`], // from file 01
    cache: {
      cacheKeyParts: (args) => ({ workspaceId: args.workspaceId }),
    },
  },
}
```

### Extend `computeCacheKey` to fold in extra parts

```ts
// utilities/cache.ts
export function computeCacheKey(input: {
  method: string;
  url: string;
  tenantId?: string;
  authFingerprint?: string;
  extraParts?: Record<string, string>; // NEW
}): string {
  const prefix = `${input.method.toUpperCase()}:${input.url}`;
  const extra = input.extraParts
    ? Object.entries(input.extraParts).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&')
    : '';
  const scope = `${input.tenantId ?? ''}|${input.authFingerprint ?? ''}|${extra}`;
  return `${prefix}#${hash(scope)}`;
}
```

Sorting the entries before joining is required for determinism — two calls
supplying `{ a: '1', b: '2' }` vs `{ b: '2', a: '1' }` must hash identically
(object key order isn't guaranteed to be insertion order across all code
paths that might construct this object).

### Call site wiring (`createClient.ts:732-740`)

```ts
const extraParts = resolved.cache.cacheKeyParts?.(args, { tenantId, authFingerprint: fp ?? undefined });
cacheKey = computeCacheKey({
  method, url: identityUrl,
  ...(tenantId !== undefined ? { tenantId } : {}),
  ...(fp !== null ? { authFingerprint: fp } : {}),
  ...(extraParts ? { extraParts } : {}),
});
```

`cacheKeyParts` throwing must degrade the same way the existing
auth-fingerprint resolution does (`createClient.ts:691-696`: getter throws
→ caching disabled for that request, fail closed) — never fall back to a
key that silently omits the extra parts, since that would put two logically
distinct responses under what looks like a correctly-scoped-but-actually-
collided key.

## Why this is safer than just documenting `keyResolver` better

`keyResolver` replaces the entire key computation — a developer using it to
add "workspace id" has to remember to also re-embed `tenantId`/
`authFingerprint` themselves, and nothing checks that they did. `cacheKeyParts`
can only ever **add** dimensions on top of the pipeline's own scoping, which
is mandatory and untouchable from this function's return value — the
cross-tenant isolation invariant (plan `README.md` constraint #1) holds by
construction, not by developer discipline.

## Security constraints specific to this file

- `cacheKeyParts`'s return value must be treated as **untrusted for
  structure** (a developer could return non-string values, `__proto__` as a
  key, etc.) — stringify defensively (`String(v)`) and reject/skip
  dangerous key names (`__proto__`, `constructor`, `prototype`) the same way
  `deepMerge` already guards against prototype pollution
  (`mergeModuleConfig.ts:51`) — reuse that guard's key-blocklist rather than
  writing a second one.
- This does not change what data the *response* can contain — it only
  changes how finely responses are partitioned in the cache. Over-broad
  `cacheKeyParts` (returning too little) causes a correctness bug (stale/
  wrong data served across contexts that should've been separated) but
  never a new *security* class beyond what's already true of any cache
  misconfiguration — still worth calling out clearly in the JSDoc: "if your
  endpoint's response depends on a value, that value MUST appear either in
  the URL or in `cacheKeyParts`, or responses can leak across contexts."
  This is the actual fix for the "dashboard shows another user's data"
  failure mode the user described — make the JSDoc say this explicitly, not
  just describe the mechanism.
- Must compose with file `01`'s tag index untouched — tags and key parts are
  independent axes (tags group entries for invalidation, key parts partition
  entries for storage); no interaction to guard against beyond both reading
  from the same resolved `args`/`ctx`.

## Tests to add

`packages/core/src/utilities/cache.test.ts` (extend):
- `computeCacheKey` with `extraParts` produces a different key than without,
  and is order-independent (`{a,b}` vs `{b,a}` hash identically).
- `extraParts` with a `__proto__`/`constructor` key doesn't pollute
  `Object.prototype` and doesn't crash key computation (reject/strip it).

`packages/core/src/factory/createClient.test.ts` (extend):
- Two calls to the same URL with different `cacheKeyParts` output (e.g.
  different `workspaceId`) produce independent cache entries — the direct
  regression test for the dashboard scenario.
- `cacheKeyParts` throwing disables caching for that request (fail closed),
  never silently omits the extra scoping.
- A `keyResolver` still works unchanged when `cacheKeyParts` isn't also set
  (no regression to the existing override path).

## Docs to update after shipping

`docs/caching.md` — add a "scoping cache by more than the URL" section with
the dashboard/workspace example; `docs/multi-tenancy.md` — cross-link, since
this is conceptually an extension of the same scoping problem tenancy
already solves for tenant/auth identity.
