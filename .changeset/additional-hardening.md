---
"@developerehsan/api-client": minor
---

Add a grab-bag of caching hardening features:

- Negative caching (`cache.cacheableStatuses`/`negativeTtl`) for error statuses like 404.
- ETag/`If-None-Match` conditional revalidation — automatic once a response captures an `ETag`.
- `client.cache.getStats()` — aggregate hit/miss/hitRate metrics.
- A circuit breaker for a failing persistent (L2) store (`cache.circuitBreaker`), observable via `cache.onStoreError`.
- At-rest encryption for IndexedDB (`createIndexedDbStore({ encrypt })`) — bring your own cipher, no default key management.
- Schema-version cache busting: a cached entry is invalidated automatically once the runtime OpenAPI schema hash changes (e.g. after a deploy).
- `client.cache.preview(pattern)` — dry-run a glob invalidation before running it for real.

All are opt-in / additive; default behavior is unchanged.
