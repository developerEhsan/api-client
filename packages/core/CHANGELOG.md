# @developerehsan/api-client

## 1.1.0

### Minor Changes

- [#27](https://github.com/developerEhsan/api-client/pull/27) [`ed369db`](https://github.com/developerEhsan/api-client/commit/ed369db8f57d8460021a75b3e32ddbb67d086346) Thanks [@developerEhsan](https://github.com/developerEhsan)! - Give the IndexedDB and Redis cache stores adapter-specific config: IndexedDB gains `version`, `onQuotaExceeded`, and proactive `maxEntries` eviction; Redis gains a real `clear()` (opt-in via `scanKeys`, namespace-safe) and a custom `serializer`. Both gain a shared `onStoreError` diagnostic hook (error + op/key only, never cached data).

- [#27](https://github.com/developerEhsan/api-client/pull/27) [`ed369db`](https://github.com/developerEhsan/api-client/commit/ed369db8f57d8460021a75b3e32ddbb67d086346) Thanks [@developerEhsan](https://github.com/developerEhsan)! - Add a grab-bag of caching hardening features:

  - Negative caching (`cache.cacheableStatuses`/`negativeTtl`) for error statuses like 404.
  - ETag/`If-None-Match` conditional revalidation — automatic once a response captures an `ETag`.
  - `client.cache.getStats()` — aggregate hit/miss/hitRate metrics.
  - A circuit breaker for a failing persistent (L2) store (`cache.circuitBreaker`), observable via `cache.onStoreError`.
  - At-rest encryption for IndexedDB (`createIndexedDbStore({ encrypt })`) — bring your own cipher, no default key management.
  - Schema-version cache busting: a cached entry is invalidated automatically once the runtime OpenAPI schema hash changes (e.g. after a deploy).
  - `client.cache.preview(pattern)` — dry-run a glob invalidation before running it for real.

  All are opt-in / additive; default behavior is unchanged.

- [#27](https://github.com/developerEhsan/api-client/pull/27) [`ed369db`](https://github.com/developerEhsan/api-client/commit/ed369db8f57d8460021a75b3e32ddbb67d086346) Thanks [@developerEhsan](https://github.com/developerEhsan)! - Add cross-instance cache invalidation via Redis pub/sub: `createRedisStore(client, { crossInstance: true })` broadcasts tag/key/clear invalidations to sibling server instances (opt-in, off by default). Fixes stale cache reads when a mutation lands on one instance behind a load balancer but the stale GET was cached on another.

- [#27](https://github.com/developerEhsan/api-client/pull/27) [`ed369db`](https://github.com/developerEhsan/api-client/commit/ed369db8f57d8460021a75b3e32ddbb67d086346) Thanks [@developerEhsan](https://github.com/developerEhsan)! - Add `cache.cacheKeyParts` — extra cache-key dimensions folded into the built-in tenant/auth-fingerprint scoping, settable per auto-method descriptor (computed from call args) or statically at the module/global/per-call layer. Safer than `keyResolver` for the common "add one more thing to the scope" case (e.g. an admin viewing "as" a target user, or a multi-workspace dashboard) since it can only add dimensions, never drop the existing tenant/auth isolation. A descriptor's `cacheKeyParts(args)` throwing fails closed (disables caching for that call). Also fixes a pre-existing gap where `cache.keyResolver` was declared on `CacheConfig` but never actually wired into the request pipeline.

- [#27](https://github.com/developerEhsan/api-client/pull/27) [`ed369db`](https://github.com/developerEhsan/api-client/commit/ed369db8f57d8460021a75b3e32ddbb67d086346) Thanks [@developerEhsan](https://github.com/developerEhsan)! - Add `createFileSystemStore` — a Node-only, disk-backed `PersistentCacheStore` (the `.next/cache` / nginx `proxy_cache` shape) for long-running server processes that want to trade RAM for disk and survive restarts. Cache keys are SHA-256 hashed into fixed-length filenames (no path traversal), writes are atomic (write-then-rename), and it accepts the same `onStoreError`/`maxSizeBytes`/`encrypt` options as the other adapters. Not for serverless/edge; does not solve cross-instance staleness (use Redis `crossInstance` for that).

- [#27](https://github.com/developerEhsan/api-client/pull/27) [`ed369db`](https://github.com/developerEhsan/api-client/commit/ed369db8f57d8460021a75b3e32ddbb67d086346) Thanks [@developerEhsan](https://github.com/developerEhsan)! - Add memory-aware caching for constrained hosts: `cache.maxSizeBytes` (approximate byte cap alongside the existing entry-count `maxSize`), `cache.mode` (`'layered'` default, `'l1-only'`, `'l2-only'` with a tiny bounded shadow L1), and a Node-only opt-in `cache.memoryPressure` guard that proactively evicts before RSS crosses a threshold.

- [#27](https://github.com/developerEhsan/api-client/pull/27) [`ed369db`](https://github.com/developerEhsan/api-client/commit/ed369db8f57d8460021a75b3e32ddbb67d086346) Thanks [@developerEhsan](https://github.com/developerEhsan)! - Add a callback alternative to endpoint-based OAuth2 refresh (`refresh: (refreshToken) => Promise<OAuth2Tokens>`, for refresh logic that isn't "just POST a URL") and pluggable `tokenStorage` (mirrors `PersistentCacheStore`'s adapter pattern; ships `createMemoryTokenStorage`/`createLocalStorageTokenStorage`). Both are mutually exclusive with the existing `refreshEndpoint`/manual-getters shape, enforced at the type level and defense-in-depth at construction time.

- [#27](https://github.com/developerEhsan/api-client/pull/27) [`ed369db`](https://github.com/developerEhsan/api-client/commit/ed369db8f57d8460021a75b3e32ddbb67d086346) Thanks [@developerEhsan](https://github.com/developerEhsan)! - Add a dev-time server-only guard: `createRpcHandler` now throws immediately if constructed in a browser context (`enforceServerOnly`, on by default), and `defineModule({ serverOnly: true, ... })` does the same for your own server-only modules. Both are defense-in-depth on top of the existing `scripts/check-browser-bundle.mjs` CI check, which remains authoritative.

- [#27](https://github.com/developerEhsan/api-client/pull/27) [`ed369db`](https://github.com/developerEhsan/api-client/commit/ed369db8f57d8460021a75b3e32ddbb67d086346) Thanks [@developerEhsan](https://github.com/developerEhsan)! - Add tag-based cache invalidation: `cacheTags`/`invalidatesTags` on auto-method descriptors and `cache.tags`/`cache.invalidatesTags` on per-call config, plus `client.cache.invalidateTags(tags)`. A mutation's `invalidatesTags` now clears every cached copy of a tagged resource in one process, regardless of which auth scope cached it — fixing stale GETs after a mutation and same-VM cross-user staleness.

### Patch Changes

- [#27](https://github.com/developerEhsan/api-client/pull/27) [`ed369db`](https://github.com/developerEhsan/api-client/commit/ed369db8f57d8460021a75b3e32ddbb67d086346) Thanks [@developerEhsan](https://github.com/developerEhsan)! - Document and type-test full type-safety without codegen: `createTypedClient<Ops>()` already accepts a hand-written `Ops` interface with the exact shape codegen emits (`{ params, query, body, response }` per operation) — see `docs/manual-types.md`.

## 1.0.0

### Major Changes

- [#17](https://github.com/developerEhsan/api-client/pull/17) [`49ae954`](https://github.com/developerEhsan/api-client/commit/49ae9545c3e3bcc20b47425461507b86c47cfbae) Thanks [@developerEhsan](https://github.com/developerEhsan)! - Major overhaul: developer experience, type-safety, modular logic, and roadmap features.

  **Breaking / behavioral**

  - `ctx.request` is now generic over the literal `path` (`request<T, const P>`): a path
    with `{placeholders}` requires exactly those `pathParams` at compile time (missing/typo
    is now a type error). Explicit `request<T>(...)` still works.
  - Lifecycle hooks now COMPOSE across global → module → per-call (all fire; transforming
    hooks chain). Transforming-hook return types widened to allow a `void` pass-through.
  - `createClient` fail-fasts on nonsensical config (negative ttl/attempts, bad queue
    concurrency, SWR with cache disabled, oauth2 without a refresh endpoint).
  - The dead parallel `http/pipeline.ts` implementation was removed.

  **New capabilities**

  - Config & hooks parity: `hooks` on module + per-call config; new `onSuccess`/`onSettled`;
    `onRetry` is now actually fired; per-call `queue` opt-out; `client.config.resolve()`
    returns a redacted resolved-config snapshot.
  - Type-safety: template-literal path-param inference, a typed `ClientEventMap` for
    `on`/`off`, and a `*.test-d.ts` regression suite.
  - Config-driven codegen: `api-client.config.*` files, real per-operation `diff`,
    `watchAndGenerate` (local + remote-URL polling with ETag/hash), `generate --check`
    for CI, and secret-safe remote spec fetching.
  - Modules beyond HTTP: `ctx.run` (opt-in queue/dedup/retry/timeout for any async work),
    `ctx.stream` (NDJSON/SSE/raw async iterables), `ctx.emit`/`ctx.logger`/`ctx.config`,
    and `extends: 'auto'` from the runtime schema. New `OperationError`.
  - RPC bridge: request batching (`{ __rpcBatch }`, per-sub-call validation, `maxBatchSize`),
    a built-in rate limiter (`createRateLimiter`), and TanStack Start / Remix route adapters.
  - Pluggable persistent cache stores (`@developerehsan/api-client/cache-stores`:
    memory / IndexedDB / Redis) layered behind the sync in-memory LRU.
  - React Query hooks emission (`emitReactQueryHooks`).
  - Framework glue: `withApiClientCodegen` for Next.js and the new
    `@developerehsan/api-client-vite` plugin (also covers TanStack Start).

  Security-reviewed: the RPC trust boundary, batching, prototype-pollution guards,
  `sanitizePerCall` closed-set, rate-limiter key handling, and codegen fetch hygiene were
  adversarially reviewed with numbered threat-case tests.

  > Note: loading a **TypeScript** `api-client.config.ts` requires the optional `jiti`
  > dependency (`pnpm add -D jiti`); `.mjs`/`.js`/`.json` config files work with no extra deps.

## 0.2.1

### Patch Changes

- docs: add per-package README + LICENSE and enrich npm metadata

  Each published package now ships its own `README.md` (so the docs render on the
  npm package page) and a bundled `LICENSE`. Package descriptions and keywords were
  expanded for better npm search discoverability. No runtime changes.

## 0.2.0

### Minor Changes

- [#1](https://github.com/developerEhsan/api-client/pull/1) [`4d7e4d6`](https://github.com/developerEhsan/api-client/commit/4d7e4d6244e6325d2b79233ded755d006f1d2601) Thanks [@developerEhsan](https://github.com/developerEhsan)! - Initial public release: typed, modular, universal API client factory with OpenAPI
  codegen, the SSR RPC bridge (`/server` + `/browser`), and framework-agnostic
  TanStack Query integration for React, Vue, and Solid.
