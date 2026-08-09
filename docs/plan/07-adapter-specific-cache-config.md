# 07 — Adapter-specific cache backend configuration

Depends on: [`03-memory-aware-caching.md`](./03-memory-aware-caching.md) (adds `mode`, which interacts with backend choice).

## Problem

`createIndexedDbStore` and `createRedisStore` (`cache-stores/index.ts:66-125`,
`158-188`) are genuinely different tools with different operational
concerns, but both are exposed as flat, minimal option bags. IndexedDB is a
browser storage quota with its own failure modes (quota exceeded, browser
private-mode restrictions); Redis is a network service with cluster/auth/
serialization concerns. Today's options (`IndexedDbStoreOptions`:
`dbName`/`storeName`; `RedisStoreOptions`: `keyPrefix`, plus `crossInstance`/
`channel` from file `02`) don't give enterprises the control they need over
either.

## Current state (reference)

- `IndexedDbStoreOptions` — `cache-stores/index.ts:46-51` (`dbName`, `storeName`).
- `createIndexedDbStore` body — `cache-stores/index.ts:66-125` — single DB,
  single object store, no quota handling (a `QuotaExceededError` from
  `put()` surfaces through the existing `guard()` catch-all as a silent
  `undefined`/no-op today — indistinguishable from any other IndexedDB
  failure).
- `RedisLikeClient` — `cache-stores/index.ts:128-132` (`get`/`set`/`del`
  only; file `02` adds optional `publish`/`subscribe`).
- `RedisStoreOptions` — `cache-stores/index.ts:135-138` (`keyPrefix` only).
- `createRedisStore` — `cache-stores/index.ts:158-188` — `clear()` is
  documented as a no-op today ("namespace-wide deletion needs SCAN... left to
  the caller", lines 144-145, 184-186) — a real enterprise gap (a "log out
  and wipe everything" flow can't rely on it).

## Design

### IndexedDB: quota handling + versioning + eviction policy

```ts
// cache-stores/index.ts
export interface IndexedDbStoreOptions {
  dbName?: string;
  storeName?: string;
  /**
   * IndexedDB schema version. Bump when changing `storeName` or otherwise
   * needing an `onupgradeneeded` migration. @default 1
   */
  version?: number;
  /**
   * Called when a `set()` fails due to storage quota being exceeded
   * (`QuotaExceededError` or equivalent). Default behavior: swallow (matches
   * today's silent no-op via `guard()`). Provide this to detect the
   * condition (e.g. to fall back to a smaller in-memory-only cache, or
   * surface a warning) rather than have it disappear into `guard()`'s catch-all.
   */
  onQuotaExceeded?: (error: unknown) => void;
  /**
   * When set, `set()` proactively evicts the oldest N% of entries (by
   * `storedAt`) before writing, once total entry count exceeds this —
   * a coarse client-side LRU for IndexedDB, since the browser doesn't
   * enforce one. @default optional, unset means no proactive eviction
   */
  maxEntries?: number;
}
```

Implementation notes: `onQuotaExceeded` requires distinguishing a quota
error from other IndexedDB failures inside the existing `guard()` helper
(`cache-stores/index.ts:101`) — check `error.name === 'QuotaExceededError'`
(standard DOM exception name) before invoking the callback, and still
resolve to the same fallback value either way (never let this new callback
turn a swallowed failure into a thrown one — that would be a behavior
regression for the write path).

### Redis: real `clear()`, cluster-awareness, serialization override

```ts
export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
  publish?(channel: string, message: string): Promise<unknown>;      // from file 02
  subscribe?(channel: string, onMessage: (m: string) => void): Promise<unknown>; // from file 02
  /**
   * Optional: enables a real namespace-wide `clear()` via SCAN+DEL instead
   * of today's no-op. Most node-redis/ioredis clients expose this as
   * `scanIterator`/`scanStream` — the exact shape is client-specific, so
   * this is intentionally a caller-supplied function rather than an
   * assumed method name.
   */
  scanKeys?(matchPattern: string): AsyncIterable<string>;
}

export interface RedisStoreOptions {
  keyPrefix?: string;
  crossInstance?: boolean; // from file 02
  channel?: string;        // from file 02
  /**
   * Custom serializer, e.g. to add compression or a schema-versioned
   * envelope. @default JSON.stringify / JSON.parse
   */
  serializer?: { stringify: (entry: CacheEntry) => string; parse: (raw: string) => CacheEntry | undefined };
}
```

`clear()` implementation, when `scanKeys` is provided:

```ts
async clear() {
  if (!client.scanKeys) return; // unchanged no-op behavior when not supplied
  for await (const key of client.scanKeys(`${prefix}*`)) {
    await client.del(key);
  }
}
```

This keeps the **default** behavior identical to today (no-op) per
constraint #7 (no silent behavior change) — `clear()` only becomes real once
a developer explicitly wires `scanKeys`, which requires them to have
already thought about the SCAN-vs-KEYS production-safety tradeoff the
existing doc comment warns about.

### Both: a shared `onError` reporting hook

Neither store gives visibility into backend failures today — both silently
degrade to "as if the entry wasn't there." For an enterprise running this in
production, silent degradation without any observability hook is a real gap
(you can't tell "Redis is down and every request is a cache miss" from
"cache is just cold"). Add a consistent, optional hook to both option types:

```ts
onStoreError?: (error: unknown, context: { op: 'get' | 'set' | 'delete' | 'clear'; key?: string }) => void;
```

Fire it from inside each store's existing catch/guard paths, in addition to
(never instead of) the current swallow-and-degrade behavior. This is the
minimal building block file `08`'s metrics/circuit-breaker ideas can build
on later — keep it generic (an error + context), not backend-specific.

## Security constraints specific to this file

- `serializer.parse` runs on data read back from Redis — **never
  `eval`/`Function`-based deserialization**; the default and any documented
  example must be `JSON.parse` or an equally safe structured format. If a
  developer supplies a custom serializer, document the requirement plainly
  (their responsibility, but the docs must not lead them toward an unsafe
  choice via a bad example).
- `scanKeys` executing arbitrary caller-supplied iteration logic must still
  go through the same `k(key)`-prefixed namespace — never `del()` a key
  outside this store's own `keyPrefix` namespace, even if the caller's
  `scanKeys` implementation returns something unexpected. Validate the
  prefix before deleting, don't just trust the pattern match blindly (a
  buggy caller-supplied `scanKeys` could otherwise cause this store to
  delete unrelated application keys sharing the same Redis instance).
- `onQuotaExceeded`/`onStoreError` payloads must carry the **error and
  operation context only**, never the cache entry's `data` — these are
  diagnostic hooks, not a second channel for cached response bodies to leak
  through logging.

## Tests to add

`packages/core/src/cache-stores/indexeddb.test.ts` (extend, using a fake
IndexedDB shim or the existing test harness): `onQuotaExceeded` fires on a
simulated `QuotaExceededError`, doesn't fire on other errors; `maxEntries`
proactively evicts before a write once the threshold is crossed.

`packages/core/src/cache-stores/redis.test.ts` (extend, using the existing
fake `RedisLikeClient` pattern): `clear()` remains a no-op when `scanKeys`
is absent (regression guard); `clear()` deletes only keys matching this
store's `keyPrefix` when `scanKeys` is supplied, even if the fake
`scanKeys` yields a key outside the prefix (assert it's filtered/rejected,
not deleted).

`packages/core/src/cache-stores/onStoreError.test.ts` (new): both stores
fire `onStoreError` with the right `op`/`key` on a simulated backend
failure, and the call's own return value (fallback) is unchanged from
today's behavior.

## Docs to update after shipping

`docs/cache-persistence.md` — expand the IndexedDB and Redis sections with
these new options and a "monitoring cache backend health" subsection using
`onStoreError`.
