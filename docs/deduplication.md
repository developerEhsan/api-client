# Deduplication

[← Docs index](./README.md)

When several callers ask for the same thing at the same time — two components
mounting and both requesting the current user, a burst of retries hitting the
same endpoint — deduplication collapses the identical **in-flight** requests
into **one** network call; every caller receives the same result (or the same
error). On by default for `GET`.

```ts
http: {
  deduplication: true,        // default
  dedupeMethod: ['GET'],      // add 'POST' etc. to dedupe those too
}
```

## Pipeline order: cache is checked first

The client's `run` closure resolves a response in this order (verified against
`packages/core/src/factory/createClient.ts`):

1. **Cache lookup** (`produce()`, `createClient.ts:989-991`) — for a `GET`
   with cache enabled, the cache store is consulted *before* the queue or
   dedup ever run. A cache hit (under `cache-first`, the default strategy)
   returns immediately — no queueing, no dedup, no network call.
2. Only on a cache **miss** (or under `strategy: 'network-first'`) does the
   request reach `fetchThrough()` (`createClient.ts:930-984`), which wraps the
   network call as `withQueue(() => withDedup(async () => { ...runNetwork() })`
   — i.e. **queue, then dedup**, then the actual dispatch/retry/validate cycle.
3. A successful network response is written back to the cache
   (write-through) before being returned.

So the full order is **cache → queue → dedup → dispatch(retry) → validate →
cache write-through**. This resolves an apparent conflict between two
descriptions elsewhere: cache genuinely sits in front of queue/dedup for a
single request, but because concurrent *cache misses* all fall through to the
same `fetchThrough()` call, they still coalesce into one shared in-flight
network request via dedup — the cache is only checked once per call, not
re-checked while waiting on that shared promise.

Dedup keys include the **auth fingerprint** and **tenant**, so requests with
different credentials or tenants are never merged (see
[authentication](./authentication.md#auth--cachededup-safety)).

## Custom dedup key via `keyResolver` interaction

Dedup itself doesn't take a custom-key option — it derives its key from
method + identity URL + body + tenant + auth fingerprint
(`computeDedupeKey`). If you need requests with different query params that
are *conceptually* the same call to dedup together, normalize the URL/args
before calling (e.g. sort query params in the descriptor), rather than trying
to override the dedup key directly — there's no separate dedup `keyResolver`
the way `cache.keyResolver` exists for cache keys (see
[caching](./caching.md)).

## Per-call opt-out

```ts
await api.users.get('42', undefined, { skipDedup: true })
```

Use this when you deliberately want two calls that look identical to hit the
network independently (e.g. a manual "retry" button that shouldn't just
attach to the original in-flight promise).

## Opting additional methods in

```ts
http: {
  deduplication: true,
  dedupeMethod: ['GET', 'POST'],   // now identical POSTs also coalesce
}
```

Only opt a `POST`/`PATCH`/etc. into dedup when it's genuinely idempotent from
the caller's point of view — two logically-identical mutating calls sharing
one in-flight promise means the second caller never actually re-triggers the
side effect, it just observes the first one's result.

## See it live

The Feature Lab "Deduplication (6→1)" button fires **six** identical requests at
once and the live pipeline log shows only **one** `→ request` line — the other
five shared it:
[`examples/react-vite/src/features/FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx).

## Gotchas / troubleshooting

- **"My dedup isn't merging requests."** Check `dedupeMethod` includes your
  HTTP method, and that neither call passed `skipDedup: true`. Also confirm
  both calls resolve to the same auth fingerprint — see
  [authentication](./authentication.md#auth--cachededup-safety).
- **"Two different users are seeing merged data."** Shouldn't happen — dedup
  keys always include the auth fingerprint and tenant. If it does, check that
  your `getToken`/tenant resolver isn't returning a shared/incorrect value.
- Related: [caching](./caching.md) for the layer checked before dedup,
  [concurrency queue](./concurrency-queue.md) for the layer checked between
  cache and dedup.
