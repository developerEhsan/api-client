# 02 — Cross-instance invalidation (Redis pub/sub)

Depends on: [`01-tag-based-invalidation.md`](./01-tag-based-invalidation.md) (this file broadcasts the same tag-invalidation events across processes).

## Problem

File `01` fixes invalidation **within one process** — one Node/edge server
instance, one in-memory tag index, works regardless of how many different
auth scopes cached a copy.

It does **not** fix invalidation **across processes**. Any real production
deployment with more than one server instance behind a load balancer has N
independent in-memory caches. Admin's request lands on instance A, calls
`invalidatesTags(['user:123'])`, clears instance A's copies. Instances B and
C never hear about it. A user whose request happens to land on B or C keeps
seeing stale data until TTL expiry.

This is a distributed-systems problem with a standard answer: a shared
broadcast channel. The user explicitly asked for "what Redis provides" —
Redis's `PUBLISH`/`SUBSCRIBE` is exactly the right tool, and the codebase
already has an injected-client Redis store (`createRedisStore`,
`packages/core/src/cache-stores/index.ts:158-188`) to build on.

## Current state (reference)

- `PersistentCacheStore` interface — `cache-stores/store.types.ts:19-24`
  (`get`/`set`/`delete`/`clear`, all async, no pub/sub concept today).
- `RedisLikeClient` interface — `cache-stores/index.ts:128-132` (`get`/`set`/`del`
  only — no `publish`/`subscribe`).
- `createLayeredCacheStore` — `cache-stores/layered.ts:20-52` — L1 sync +
  L2 async, write-through, background read-warm on miss. This is the piece
  that needs to also react to *externally originated* invalidations.
- `client.cache.invalidate`/new `invalidateTags` (file `01`) — currently only
  affect the local process's `cacheStore`/`tagIndex`.

## Design

### 1. Extend `RedisLikeClient` with optional pub/sub, additively

```ts
// cache-stores/index.ts
export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
  /** Optional: required only when `crossInstance` invalidation is enabled. */
  publish?(channel: string, message: string): Promise<unknown>;
  /** Optional: required only when `crossInstance` invalidation is enabled.
   *  Most Redis clients (node-redis, ioredis) require a DEDICATED connection
   *  for subscribe mode — callers typically pass a second client instance
   *  here, not the same one used for get/set/del. */
  subscribe?(channel: string, onMessage: (message: string) => void): Promise<unknown>;
}
```

Optional fields keep this backward compatible (constraint #4 in the plan
README) — existing `createRedisStore(client)` callers who never touch
`crossInstance` are unaffected.

### 2. New broadcast payload — tags/keys only, never data

```ts
interface InvalidationMessage {
  type: 'tags' | 'keys' | 'clear';
  /** Present when type is 'tags' or 'keys'. Opaque strings only. */
  values?: string[];
  /** Origin instance id, to let a publisher ignore its own echo. */
  origin: string;
}
```

**Security constraint: the payload must never contain cached response data,
headers, or auth material** — only tags/keys (already-opaque, non-sensitive
identifiers) and the `clear` signal. This is a superset restriction of the
existing `PersistentCacheStore` doc comment (`store.types.ts:7-10`) about
never persisting raw auth material — the same rule extends to anything put
on the wire for pub/sub.

### 3. `createRedisStore` gains a cross-instance mode

```ts
export interface RedisStoreOptions {
  keyPrefix?: string;
  /**
   * Enables cross-instance invalidation broadcast via Redis pub/sub.
   * Requires `client.publish`/`client.subscribe` (see RedisLikeClient).
   * @default false
   */
  crossInstance?: boolean;
  /** Channel name for invalidation broadcasts. @default 'apicache:invalidate' */
  channel?: string;
}
```

When `crossInstance: true`, `createRedisStore` returns a store that also
exposes an event-emitter-like hook consumed by the client factory:

```ts
export interface PersistentCacheStore {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  /** NEW, optional. When present, the client factory subscribes to it and
   *  applies incoming invalidations to the LOCAL L1 cache + tag index. */
  onRemoteInvalidate?(handler: (msg: InvalidationMessage) => void): void;
}
```

Again additive — a plain `PersistentCacheStore` implementation without
`onRemoteInvalidate` behaves exactly as it does today.

### 4. Wire into `createClient.ts`

- When `resolved.cache.persistentStore?.onRemoteInvalidate` exists, subscribe
  once at client construction time (near where `l1Cache`/`cacheStore` are
  built, `createClient.ts:330-338`):
  ```ts
  persistentStore.onRemoteInvalidate?.((msg) => {
    if (msg.type === 'clear') cacheStore.clear();
    else if (msg.type === 'keys') for (const k of msg.values ?? []) cacheStore.delete(k);
    else if (msg.type === 'tags') {
      const keys = tagIndex.keysFor(msg.values ?? []);
      for (const k of keys) cacheStore.delete(k);
    }
  });
  ```
- When `client.cache.invalidateTags(tags)` (file `01`) or
  `client.cache.invalidate()`/`clear()` runs **locally**, and
  `crossInstance` is active, also publish the equivalent message so sibling
  instances react. Guard against echo loops using the `origin` id (a random
  string generated once per client instance) — a subscriber ignores messages
  whose `origin` matches its own id, since it already applied the change
  locally before publishing.
- All of this must be **fire-and-forget from the caller's perspective** —
  `invalidateTags` stays synchronous in its local effect; the network publish
  happens after, and its failure (Redis hiccup) must never throw back into
  the caller. Mirror the existing `swallow()` pattern in
  `cache-stores/layered.ts:21-23`.

### 5. Config surface

```ts
// CacheConfig (cache.types.ts) — no new top-level field needed; this rides
// on the existing `persistentStore` + the new RedisStoreOptions.crossInstance.
cache: {
  persistentStore: createRedisStore(redisClient, {
    crossInstance: true,
    // subscribe needs its own connection — most Redis clients require this
  }),
}
```

Auto-detection idea from the earlier discussion ("auto-on when using Redis")
is explicitly **rejected** here: default `crossInstance` to `false` even
when a Redis store is configured (constraint #7 in the plan README — no
silent behavior change, and pub/sub has a real cost — an extra dedicated
connection — that shouldn't be forced on someone who only wanted Redis as an
L2 cache, not a broadcast bus). Make it a one-line opt-in instead.

## Security constraints specific to this file

- **Channel is not a trust boundary.** Anyone who can publish to the
  configured Redis channel can trigger cache evictions on every instance.
  That's a minor availability concern (forces cache misses, not data
  exposure) as long as constraint above (payload = tags/keys only) holds.
  Document in the JSDoc that the Redis instance/channel should be on a
  network only the app's own servers can reach — this is standard Redis
  deployment hygiene, not something the library can enforce, but it must be
  called out.
- **Never trust remote invalidation payloads to contain executable or
  oversized data.** Cap `values` array length and string length defensively
  when parsing an incoming pub/sub message (reject/log and no-op rather than
  throw, matching the "L2 errors never break a request" philosophy already
  in `layered.ts`).
- Re-run `node scripts/check-browser-bundle.mjs` after this change — Redis
  client wiring must stay entirely within `cache-stores/index.ts` and never
  get pulled into `browser.js` (it already isn't, since `RedisLikeClient` is
  injected, not imported — keep it that way for the pub/sub additions too).

## Tests to add

`packages/core/src/cache-stores/redis-crossinstance.test.ts` (new, using a
fake in-memory `RedisLikeClient` with a shared pub/sub bus between two
fake-client instances to simulate two server processes):
- Instance A invalidates tag `user:123`; assert instance B's local cache
  entry for a key tagged `user:123` is evicted.
- Instance A's own publish does not cause a redundant local eviction pass
  (origin echo check) — assert local eviction happens exactly once.
- Malformed/oversized incoming message is dropped without throwing and
  without evicting unrelated keys.
- `crossInstance: false` (default) never calls `publish`/`subscribe` — no
  behavior change for existing Redis-store users.

## Docs to update after shipping

`docs/cache-persistence.md`, `docs/multi-tenancy.md` — add a "multiple
server instances" section referencing this feature explicitly, since that's
the scenario it exists for.
