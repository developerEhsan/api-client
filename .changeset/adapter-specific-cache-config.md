---
"@developerehsan/api-client": minor
---

Give the IndexedDB and Redis cache stores adapter-specific config: IndexedDB gains `version`, `onQuotaExceeded`, and proactive `maxEntries` eviction; Redis gains a real `clear()` (opt-in via `scanKeys`, namespace-safe) and a custom `serializer`. Both gain a shared `onStoreError` diagnostic hook (error + op/key only, never cached data).
