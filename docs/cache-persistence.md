# Cache persistence (L2 stores)

[← Docs index](./README.md)

The in-memory LRU [cache](./caching.md) is the L1 layer. You can layer a
**persistent L2 store** behind it via `cache.persistentStore`, so cached data
survives reloads (IndexedDB) or is shared across server instances (Redis).

Import stores from the dedicated entry:

```ts
import {
  createMemoryPersistentStore,
  createIndexedDbStore,
  createRedisStore,
  createLayeredCacheStore,
} from '@developerehsan/api-client/cache-stores'
```

This module is **environment-agnostic**: the Redis store takes an injected client
(no `redis` dependency), and the IndexedDB store feature-detects `indexedDB`, so
it's safe in any bundle.

## Memory store (tests / SSR warm-up)

```ts
const api = createClient({
  baseURL,
  openapi: { mode: 'runtime' },
  cache: { persistentStore: createMemoryPersistentStore() },
})
```

## IndexedDB (browser persistence)

```ts
cache: {
  persistentStore: createIndexedDbStore({
    dbName: 'my-app-cache',
    version: 1,                 // bump when changing storeName or migrating
    maxEntries: 500,            // proactively evicts oldest ~10% once reached
    onQuotaExceeded: (error) => console.warn('cache quota exceeded', error),
    onStoreError: (error, { op, key }) => reportToMonitoring(error, op, key),
  }),
}
```

Cached GET responses survive a page reload. `onQuotaExceeded`/`onStoreError`
are diagnostic hooks only — a write still resolves (swallowed) either way;
they exist so "IndexedDB is full/down" isn't indistinguishable from "cache is
just cold."

### At-rest encryption

```ts
cache: {
  persistentStore: createIndexedDbStore({
    encrypt: {
      encrypt: (plaintext) => myCipher.encrypt(plaintext),
      decrypt: (ciphertext) => myCipher.decrypt(ciphertext),
    },
  }),
}
```

No default cipher or key management is shipped — where the key comes from
and whether it survives a reload is inherently application-specific, and
getting that wrong is worse than not offering encryption at all. **Know what
this does and doesn't protect against:** it protects against casual
inspection of browser storage (devtools, another origin somehow reading it
via a bug). It does **not** protect against the page's own JS — code running
on your page can call `decrypt` itself, by definition. A key held only in
memory means the cache doesn't survive a reload, which may defeat the point
of IndexedDB persistence in the first place — that tension is real; there's
no way around it, only tradeoffs to pick from.

## Redis (shared server cache)

```ts
import { createClient as createRedis } from 'redis'
const redis = createRedis(/* ... */); await redis.connect()

cache: {
  persistentStore: createRedisStore(redis, {
    keyPrefix: 'myapp:',
    onStoreError: (error, { op, key }) => reportToMonitoring(error, op, key),
    // serializer: { stringify, parse }, // e.g. compression — parse must stay JSON.parse-safe
  }),
}
```

The store takes your already-connected client, so this package never depends on
`redis` directly.

### Real `clear()` via SCAN

By default `clear()` is a no-op (namespace-wide deletion needs SCAN, which
varies by client — this is the existing, unchanged default). Wire `scanKeys`
on your client object to make it real:

```ts
cache: {
  persistentStore: createRedisStore(
    {
      ...redis,
      scanKeys: async function* (pattern) {
        for await (const key of redis.scanIterator({ MATCH: pattern })) yield key;
      },
    },
    { keyPrefix: 'myapp:' },
  ),
}
```

Every key `scanKeys` yields is verified to actually sit inside this store's
own `keyPrefix` before deletion — a buggy `scanKeys` implementation can't
delete an unrelated application key sharing the same Redis instance.

## Filesystem (long-running server, trade RAM for disk)

```ts
cache: {
  persistentStore: createFileSystemStore({
    dir: '/var/cache/my-app',   // must NOT be inside a web-server-served static path
    maxSizeBytes: 100 * 1024 * 1024,
    onStoreError: (error, { op, key }) => reportToMonitoring(error, op, key),
  }),
}
```

Same shape as the Next.js data-cache (`.next/cache`) and nginx `proxy_cache` —
trades RAM for disk on a **long-running Node server process**, and survives a
restart (unlike `mode: 'l1-only'`). Node-only: resolves to a safe no-op store
(never throws at construction) if `node:fs` isn't usable, e.g. if this module
were ever reached from a browser bundle — which it isn't, since
`cache-stores` is its own build entry, never bundled into `/browser`.

Does **not** fit serverless/edge (the filesystem is ephemeral or absent
there — Lambda `/tmp`, Vercel functions, Workers). Does **not** solve
cross-instance staleness (each instance has its own disk) — don't reach for
a network filesystem (NFS/EFS) as a workaround for that; it reintroduces
cross-instance coordination with worse latency and file-locking semantics
than [Redis pub/sub](#multiple-server-instances-cross-instance-invalidation)
already gives you.

**Path safety:** every cache key is SHA-256 hashed into a fixed-length hex
filename before touching the filesystem — a hostile or malformed key
(however derived, including via [`cacheKeyParts`](./caching.md#scoping-cache-by-more-than-the-url))
can never escape `dir` or reach an unintended file. Writes are atomic
(write to a `.tmp` file, then rename) so a crash mid-write never corrupts a
read. Files default to `0o600` (owner-only) — configurable via `fileMode`.
Accepts the same `encrypt` (`CacheCipher`) option as `createIndexedDbStore`
for at-rest encryption, with the same caveats.

## Multiple server instances (cross-instance invalidation)

A single Redis store already shares *data* across instances (L2). It does not,
by default, tell sibling instances to evict their own **in-memory L1** copy
when one instance invalidates a [tag](./caching.md#tag-based-invalidation) —
so a mutation handled by instance A can leave a stale L1 entry on instances B
and C until TTL expiry. Opt into pub/sub broadcast to fix that:

```ts
import { createClient as createRedis } from 'redis'

const redis = createRedis(/* ... */); await redis.connect()
// Most Redis clients need a DEDICATED connection for subscribe mode.
const redisSub = createRedis(/* ... */); await redisSub.connect()

cache: {
  persistentStore: createRedisStore(
    { ...redis, subscribe: (channel, onMessage) => redisSub.subscribe(channel, onMessage) },
    { crossInstance: true },
  ),
}
```

Off by default (no silent behavior change, and it costs a dedicated
connection). Only tags/keys/a clear signal ever go over the wire — never
cached data, headers, or auth material. The Redis instance/channel should be
reachable only by your own servers; anyone who can publish to it can force
cache evictions on every instance (an availability nit, never a data leak).

## Constrained hosts / high traffic, low memory

`maxSize` bounds the L1 cache by entry count. On a small VM, a handful of
large responses can matter more than count. Bound by estimated bytes too, or
skip local memory almost entirely in favor of Redis:

```ts
const api = createClient({
  baseURL,
  cache: {
    maxSizeBytes: 10 * 1024 * 1024,        // 10MB soft cap on L1, alongside maxSize
    mode: 'l2-only',                       // tiny shadow L1, everything else lives in Redis
    persistentStore: createRedisStore(redisClient),
    memoryPressure: { thresholdMb: 400 },  // proactively evict before OOM (Node only)
  },
});
```

- `maxSizeBytes` — an approximate (JSON-length) byte cap; whichever of it or
  `maxSize` is hit first triggers LRU eviction.
- `mode: 'l2-only'` — keeps only a small, fixed-size shadow L1 (just enough
  to avoid a network round-trip on an immediately-repeated read) in front of
  `persistentStore`, which is required in this mode. `'l1-only'` is the
  inverse: ignore a configured `persistentStore` entirely.
- `memoryPressure` — Node-only; periodically checks `process.memoryUsage().rss`
  and proactively evicts oldest entries ahead of the other limits. No-ops
  (feature-detected) on edge/browser runtimes.

None of these change how entries are *keyed* — cross-tenant/auth isolation
via `computeCacheKey` is unaffected; this only changes where/how much is
kept in memory.

## Monitoring cache backend health

Both `createIndexedDbStore` and `createRedisStore` silently degrade to "as
if the entry wasn't there" on a backend failure by default — you can't tell
"Redis is down and every request is a cache miss" from "cache is just cold"
without `onStoreError`:

```ts
const onStoreError = (error: unknown, { op, key }: { op: string; key?: string }) => {
  metrics.increment('cache.store_error', { op })
  logger.warn('cache backend error', { op, key, error })
}

cache: { persistentStore: createRedisStore(redis, { onStoreError }) }
```

It fires in *addition* to (never instead of) the existing swallow-and-degrade
behavior — the call's own return value is unchanged. The payload is always
`(error, { op, key? })` — never the cache entry's `data`, so this can't
become a second channel for cached response bodies to leak through logging.

## Circuit breaker for a failing L2

Without a circuit breaker, every request still attempts the persistent
store and pays its full timeout before falling through — repeatedly, for as
long as an outage lasts. Opt in to stop attempting L2 during a cool-down
once failures pile up:

```ts
cache: {
  persistentStore: createRedisStore(redis),
  circuitBreaker: { failureThreshold: 5, cooldownMs: 30_000 },
  onStoreError: (error, { op }) => {
    if (op === 'circuit-open') alertOncall('cache L2 circuit opened')
    if (op === 'circuit-close') logger.info('cache L2 circuit closed')
  },
}
```

After `failureThreshold` consecutive L2 failures, calls serve L1-only for
`cooldownMs` — the same degraded-but-safe behavior L2 failures already fall
back to, just without the repeated timeout cost. After cooldown, one probe
attempt runs: success closes the circuit, failure reopens it for another
cooldown window (so a permanently-down backend never quietly disables
persistence forever with no way to recover without a restart).

## Schema-version cache busting on deploy

When using [runtime schema mode](./codegen.md), every cached entry captures
the active OpenAPI schema hash. A deploy that changes response shapes bumps
that hash — any entry written under the old hash is treated as a miss
(evicted, refetched) rather than served to a client now expecting the new
shape. This is automatic; there's nothing to configure.

## Layering explicitly

`createLayeredCacheStore(...)` composes multiple stores (e.g. IndexedDB in front
of a remote store) if you need more than one L2 tier.

See the [API reference](./api-reference.md) for the full `PersistentCacheStore`
interface.
</content>
