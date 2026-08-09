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

**Dry run before a glob invalidation:** `api.cache.preview('users.*')`
returns the keys `invalidate('users.*')` would remove, without removing
them — a typo'd pattern (e.g. `user.*` matching more than intended) is
cheap to catch before it wipes cache entries.

## Negative caching (cache "not found" responses)

Repeated lookups for a resource that doesn't exist normally hit the network
every time. Cache specific error statuses instead, with their own (usually
shorter) TTL:

```ts
cache: { cacheableStatuses: [404], negativeTtl: 5_000 }
```

A cache hit on a negative entry still **rejects the call**, exactly like a
live request would — this only saves the network round-trip, it never turns
an error into a success. Scoped by the same tenant/auth-fingerprinted key as
any other entry, and cleared by [tag invalidation](#tag-based-invalidation)
like any other entry too.

## ETag / conditional requests

When a cached entry captured an `ETag` response header, the next
revalidation fetch automatically sends `If-None-Match`. A `304` keeps the
existing cached `data` (refreshing only `storedAt`/`expiresAt`) instead of
re-parsing a would-be-identical body. No config needed — this activates
automatically whenever the server sends `ETag`.

## Metrics

```ts
api.cache.getStats() // { hits, misses, size, hitRate }
```

Pure aggregation of the same `onCacheHit`/`onCacheMiss` firings above — no
extra hook to wire up. `hitRate` is `0` at zero requests (no division by zero).

## Tag-based invalidation

Tag a GET response, then invalidate by tag after a mutation — clears every
cached copy of the resource **regardless of which auth scope cached it**
(fixes stale GETs after an update, and same-VM staleness between two users):

```ts
// auto-method descriptor
users: {
  getUser: { method: 'GET', path: '/users/{id}', cacheTags: (args) => [`user:${args.pathParams.id}`] },
}

// ad-hoc, per call
await api.users.getUser({ id: '123' }, { cache: { tags: ['user:123'] } })
await api.users.updateUser({ id: '123' }, body, { cache: { invalidatesTags: ['user:123'] } })

// manually, e.g. from a webhook handler
api.cache.invalidateTags(['user:123'])
```

Tags are exact-match labels used only to drive invalidation — never to gate
read access to cached data — so it's safe to derive one from user-controlled
input (e.g. a resource id); the worst case is an unnecessary eviction, never
a cross-scope data read.

## Scoping cache by more than the URL

By default a cache key is `method + url + tenantId + authFingerprint`. That's
not enough when a same-URL endpoint's response legitimately depends on
something else — e.g. an admin dashboard viewing "as" a target user, or a
multi-workspace app where the active workspace comes from a header/param
rather than the URL path. `cacheKeyParts` adds dimensions on top of the
built-in scoping, safely:

```ts
// per auto-method descriptor — computed from the resolved call input
dashboard: {
  getSummary: { method: 'GET', path: '/dashboard/summary', cacheKeyParts: (args) => ({ workspaceId: args?.query?.workspaceId }) },
}

// ad-hoc, per call
await api.dashboard.getSummary(undefined, { cache: { cacheKeyParts: { workspaceId: 'ws_123' } } })
```

Unlike `keyResolver` (a full override that replaces key derivation entirely
— easy to accidentally drop tenant/auth scoping while doing so),
`cacheKeyParts` can only ever **add** dimensions on top of the pipeline's own
scoping, which stays untouched. **If your endpoint's response depends on a
value, that value MUST appear either in the URL or in `cacheKeyParts`, or
responses can leak across contexts** — two admins "viewing as" different
users would otherwise share one cached response. A descriptor's
`cacheKeyParts(args)` throwing disables caching for that one call (fails
closed) rather than silently omitting the extra scoping. See
[multi-tenancy](./multi-tenancy.md) for the related tenant/auth scoping this
extends.

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
