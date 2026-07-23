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
cache: { persistentStore: createIndexedDbStore({ /* dbName, storeName */ }) }
```

Cached GET responses survive a page reload.

## Redis (shared server cache)

```ts
import { createClient as createRedis } from 'redis'
const redis = createRedis(/* ... */); await redis.connect()

cache: { persistentStore: createRedisStore(redis /*, { prefix, ttlSeconds } */) }
```

The store takes your already-connected client, so this package never depends on
`redis` directly.

## Layering explicitly

`createLayeredCacheStore(...)` composes multiple stores (e.g. IndexedDB in front
of a remote store) if you need more than one L2 tier.

See the [API reference](./api-reference.md) for the full `PersistentCacheStore`
interface.
</content>
