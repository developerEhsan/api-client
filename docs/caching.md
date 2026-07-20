# Caching

[← Docs index](./README.md)

Caching applies to **GET** requests. Configure globally, per module, or per call.

```ts
cache: {
  enabled: true,                         // default true
  strategy: 'stale-while-revalidate',    // see below
  ttl: 60_000,                           // ms until an entry is stale
  maxSize: 500,                          // LRU capacity
  onEvict: (key, entry) => {},           // optional
}
```

## Strategies

| Strategy | Behavior |
| --- | --- |
| `cache-first` (default) | Return a fresh entry if present; otherwise fetch and cache. |
| `network-first` | Try the network; on failure fall back to a cached entry if one exists. |
| `stale-while-revalidate` | Return a stale entry **immediately**, revalidate in the background, keep the stale copy if revalidation fails. |

**See it live:** the example uses `stale-while-revalidate` with a 30s TTL. The
Feature Lab "Caching / SWR" button calls the same endpoint twice and reports the
timing (first ~network, second ~0ms from cache) —
[`FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx). Config in
[`api.config.ts`](../examples/react-vite/src/lib/api/api.config.ts).

## Cache keys are safe by construction

Keys include the HTTP method, URL, tenant id, **and an auth fingerprint** — so
two users with different tokens never share a cached response.

## Invalidation & busting

```ts
api.cache.get(key)                 // read a raw entry
api.cache.clear()                  // wipe everything
api.cache.invalidate('users.*')    // glob invalidation (* wildcard)

// Per call: skip the cache and refresh it.
await api.users.list(params, { cache: { bust: true } })
```

## Cache events / hooks

```ts
createClient({
  hooks: {
    onCacheHit:  (key, entry) => {},
    onCacheMiss: (key) => {},
  },
})
// or: api.on('cacheHit', ({ key, entry }) => {})
```

The Next.js example logs cache hits via the `onCacheHit` hook —
[`examples/nextjs/lib/api/api.config.ts`](../examples/nextjs/lib/api/api.config.ts).

## Persisting the cache (L2 store)

Layer a persistent store (memory / IndexedDB / Redis) behind the in-memory LRU —
see [cache persistence](./cache-persistence.md).
</content>
