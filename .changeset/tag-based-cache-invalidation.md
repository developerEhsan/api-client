---
"@developerehsan/api-client": minor
---

Add tag-based cache invalidation: `cacheTags`/`invalidatesTags` on auto-method descriptors and `cache.tags`/`cache.invalidatesTags` on per-call config, plus `client.cache.invalidateTags(tags)`. A mutation's `invalidatesTags` now clears every cached copy of a tagged resource in one process, regardless of which auth scope cached it — fixing stale GETs after a mutation and same-VM cross-user staleness.
