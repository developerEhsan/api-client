---
"@developerehsan/api-client": minor
---

Add memory-aware caching for constrained hosts: `cache.maxSizeBytes` (approximate byte cap alongside the existing entry-count `maxSize`), `cache.mode` (`'layered'` default, `'l1-only'`, `'l2-only'` with a tiny bounded shadow L1), and a Node-only opt-in `cache.memoryPressure` guard that proactively evicts before RSS crosses a threshold.
