---
"@developerehsan/api-client": minor
---

Add `cache.cacheKeyParts` — extra cache-key dimensions folded into the built-in tenant/auth-fingerprint scoping, settable per auto-method descriptor (computed from call args) or statically at the module/global/per-call layer. Safer than `keyResolver` for the common "add one more thing to the scope" case (e.g. an admin viewing "as" a target user, or a multi-workspace dashboard) since it can only add dimensions, never drop the existing tenant/auth isolation. A descriptor's `cacheKeyParts(args)` throwing fails closed (disables caching for that call). Also fixes a pre-existing gap where `cache.keyResolver` was declared on `CacheConfig` but never actually wired into the request pipeline.
