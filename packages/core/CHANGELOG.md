# @developerehsan/api-client

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
