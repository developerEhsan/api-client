---
"@developerehsan/api-client": minor
---

Add `createFileSystemStore` — a Node-only, disk-backed `PersistentCacheStore` (the `.next/cache` / nginx `proxy_cache` shape) for long-running server processes that want to trade RAM for disk and survive restarts. Cache keys are SHA-256 hashed into fixed-length filenames (no path traversal), writes are atomic (write-then-rename), and it accepts the same `onStoreError`/`maxSizeBytes`/`encrypt` options as the other adapters. Not for serverless/edge; does not solve cross-instance staleness (use Redis `crossInstance` for that).
