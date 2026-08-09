---
"@developerehsan/api-client": minor
---

Add a callback alternative to endpoint-based OAuth2 refresh (`refresh: (refreshToken) => Promise<OAuth2Tokens>`, for refresh logic that isn't "just POST a URL") and pluggable `tokenStorage` (mirrors `PersistentCacheStore`'s adapter pattern; ships `createMemoryTokenStorage`/`createLocalStorageTokenStorage`). Both are mutually exclusive with the existing `refreshEndpoint`/manual-getters shape, enforced at the type level and defense-in-depth at construction time.
