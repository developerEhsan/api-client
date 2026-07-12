# Changelog

All notable changes to `@developerEhsan/api-client` are documented here. This project
adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — Unreleased

Initial implementation across all seven build phases.

### Added

- **Core factory** — `createClient` with a proxy-based `api.[module].[method]()`
  surface, `defineModule`, deep config merge (global → module → per-call).
- **Request pipeline** — queue → dedup → cache → auth → dispatch (with retry) →
  cache write, plus lifecycle hooks and per-request timeout enforcement.
- **HTTP adapters** — Axios (default, lazy-loaded) and fetch (edge-safe);
  automatic fallback to fetch on edge runtimes.
- **Auth** — bearer, cookie, apiKey, and OAuth2 strategies; mutex-coalesced
  401 → refresh → retry-once (keyed per config).
- **Utilities** — deduplicator, exponential/linear/fixed retry with full-jitter
  and `Retry-After`, LRU cache with SWR + glob invalidation, concurrency queue,
  cancellation with debounce-cancel.
- **Multi-tenancy** — precedence resolution + `AsyncLocalStorage` server context
  (`runWithTenant`), Next.js `serverTenantResolver` / `serverTokenFromCookie`.
- **Codegen** — OpenAPI 3.x parser, type + module emitters, CLI (`generate` /
  `validate` / `diff` / `--watch`).
- **Schema runtime** — background schema loading, drift detection
  (strict/loose), dependency-free response validation.
- **TanStack Query** — `@developerEhsan/api-client-query` with `/react`, `/vue`,
  `/solid`; `queryOptions` / `mutationOptions` / `infiniteQueryOptions`,
  stable query keys, `invalidateQueries`.
- **Testing** — `@developerEhsan/api-client/testing` (`createMockClient`, `MockAdapter`).

### Fixed (Phase 7 adversarial review)

Twenty confirmed correctness/edge-case bugs surfaced by a multi-agent review,
including: fetch-path timeout enforcement; dedup keys scoped by auth
fingerprint (prevents cross-user response sharing); abort-interruptible retry
backoff; `Retry-After` capped by `maxDelay`; time-based debounce-cancel window;
`linkSignals` listener-leak cleanup; non-JSON error bodies no longer
misclassified as network failures; OpenAPI 3.0 `nullable` support;
`additionalProperties` validation; `__proto__` prototype-pollution guard in
config merge; correct Node vs Next.js-server detection; and abort preservation
under `safeMode`.
