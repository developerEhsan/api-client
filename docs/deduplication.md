# Deduplication

[← Docs index](./README.md)

Identical in-flight requests are collapsed into **one** network call; every
caller receives the same result (or the same error). On by default for `GET`.

```ts
http: {
  deduplication: true,        // default
  dedupeMethod: ['GET'],      // add 'POST' etc. to dedupe those too
}

// Opt out for a single call:
await api.users.get('42', undefined, { skipDedup: true })
```

Dedup keys include the **auth fingerprint** and **tenant**, so requests with
different credentials are never merged.

Deduplication happens *after* the [cache](./caching.md) lookup, so concurrent
cache misses still coalesce into a single network round-trip and then populate
the cache once.

## See it live

The Feature Lab "Deduplication (6→1)" button fires **six** identical requests at
once and the live pipeline log shows only **one** `→ request` line — the other
five shared it:
[`examples/react-vite/src/features/FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx).
</content>
