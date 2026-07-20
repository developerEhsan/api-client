# Documentation

Complete, feature-by-feature documentation for **`@developerehsan/api-client`** — a
typed, modular, universal API client factory for TypeScript.

Every page here is self-contained: it explains one feature, shows runnable code,
and links to the exact **example source** that demonstrates it live. If you want
one long top-to-bottom guide instead, read the [project README](../README.md).

> **New here?** Start with [Getting started](./getting-started.md) →
> [Mental model](./mental-model.md) → [Modules & methods](./modules-and-methods.md).
> Then jump to whatever feature you need.

---

## The two runnable examples

Everything in these docs is exercised by two apps you can run locally:

| Example | Stack | Shows |
| --- | --- | --- |
| [`examples/react-vite`](../examples/react-vite) | React + Vite (pure client-side) | Direct typed client, TanStack Query, and an interactive **Feature Lab** for the pipeline |
| [`examples/nextjs`](../examples/nextjs) | Next.js App Router (SSR) | The **SSR RPC bridge** — call `api.module.method()` from the browser without leaking the backend URL, paths, or OpenAPI |

Both are backed by the free, CORS-enabled [DummyJSON](https://dummyjson.com) API,
so they run with **no backend setup**.

---

## Guides by topic

### Foundations
- [Getting started](./getting-started.md) — your first client in 5 minutes
- [Mental model](./mental-model.md) — the three concepts and the request pipeline
- [Modules & methods](./modules-and-methods.md) — `defineModule`, `ctx.request`, composed calls
- [Configuration reference](./configuration.md) — global → module → per-call, deep-merged
- [Responses & error handling](./responses-and-errors.md) — the `ApiResponse<T>` envelope, typed errors, `safeMode`

### The request pipeline
- [Authentication](./authentication.md) — Bearer, Cookie, API key, OAuth2 (auto 401 → refresh → retry)
- [Caching](./caching.md) — LRU + TTL, `cache-first` / `network-first` / `stale-while-revalidate`, glob invalidation
- [Deduplication](./deduplication.md) — collapse identical in-flight requests
- [Retries & backoff](./retries.md) — exponential/linear/fixed, full-jitter, `Retry-After`
- [Timeouts & cancellation](./timeouts-and-cancellation.md) — per-request timeouts, `AbortSignal`, debounce-cancel
- [Concurrency queue](./concurrency-queue.md) — cap in-flight requests
- [Multi-tenancy](./multi-tenancy.md) — per-call / per-module / global tenant, server context
- [Environments](./environments.md) — named base URLs, switch at runtime

### Beyond HTTP
- [Hooks & events](./hooks-and-events.md) — lifecycle hooks + the event emitter
- [Streaming](./streaming.md) — `ctx.stream()` → NDJSON / SSE / raw byte `AsyncIterable`
- [Modules beyond HTTP](./modules-beyond-http.md) — `ctx.run`, `ctx.emit`, `ctx.logger`, `ctx.config`
- [Cache persistence](./cache-persistence.md) — pluggable L2 stores (memory / IndexedDB / Redis)

### Tooling
- [Code generation (CLI + Vite + Next.js)](./codegen.md) — types + descriptors from OpenAPI
- [Runtime schema validation & drift detection](./schema-validation.md)
- [TanStack Query — React / Vue / Solid](./tanstack-query.md)

### SSR & security
- [SSR RPC bridge](./ssr-rpc-bridge.md) — hide the backend from the browser
- [RPC rate limiting](./rpc-rate-limiting.md) — `createRateLimiter`

### Practical
- [Testing](./testing.md) — `createMockClient` + `MockAdapter`
- [Framework & runtime guides](./frameworks.md) — React SPA, Next.js, Node, edge
- [Full API reference](./api-reference.md)
- [Troubleshooting & FAQ](./troubleshooting.md)

---

## Feature → example map

Where to see each feature actually running:

| Feature | Doc | Live in |
| --- | --- | --- |
| Typed client wiring | [modules-and-methods](./modules-and-methods.md) | [`react-vite/.../api.config.ts`](../examples/react-vite/src/lib/api/api.config.ts) |
| Direct typed calls | [getting-started](./getting-started.md) | [`DirectClientDemo.tsx`](../examples/react-vite/src/features/DirectClientDemo.tsx) |
| Caching / SWR | [caching](./caching.md) | [`FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx) |
| Deduplication | [deduplication](./deduplication.md) | [`FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx) |
| Retries & backoff | [retries](./retries.md) | [`FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx) |
| Timeout / cancellation | [timeouts-and-cancellation](./timeouts-and-cancellation.md) | [`FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx) |
| Typed errors / `safeMode` | [responses-and-errors](./responses-and-errors.md) | [`FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx) |
| Composed multi-call | [modules-and-methods](./modules-and-methods.md) | [`api.config.ts`](../examples/react-vite/src/lib/api/api.config.ts) |
| `ctx.run` (non-HTTP) | [modules-beyond-http](./modules-beyond-http.md) | [`api.config.ts`](../examples/react-vite/src/lib/api/api.config.ts) |
| Hooks & events | [hooks-and-events](./hooks-and-events.md) | [`ui.tsx` (`useEventLog`)](../examples/react-vite/src/components/ui.tsx) |
| Bearer auth + login | [authentication](./authentication.md) | [`api.config.ts`](../examples/react-vite/src/lib/api/api.config.ts) |
| TanStack Query | [tanstack-query](./tanstack-query.md) | [`TanstackDemo.tsx`](../examples/react-vite/src/features/TanstackDemo.tsx) |
| Codegen wiring | [codegen](./codegen.md) | [`types/generated/`](../examples/react-vite/src/lib/api/types/generated) |
| SSR RPC bridge | [ssr-rpc-bridge](./ssr-rpc-bridge.md) | [`nextjs/lib/api/api.config.ts`](../examples/nextjs/lib/api/api.config.ts) |
| RPC rate limiter | [rpc-rate-limiting](./rpc-rate-limiting.md) | [`nextjs/lib/api/api.config.ts`](../examples/nextjs/lib/api/api.config.ts) |
| RPC batching | [ssr-rpc-bridge](./ssr-rpc-bridge.md) | [`nextjs/lib/api/rpc-client.ts`](../examples/nextjs/lib/api/rpc-client.ts) |

---

## Packages

| Package | Import | Purpose |
| --- | --- | --- |
| `@developerehsan/api-client` | `@developerehsan/api-client` | The runtime library |
| — server entry | `.../server` | SSR RPC bridge (server half) |
| — browser entry | `.../browser` | SSR RPC bridge (browser half) |
| — codegen entry | `.../codegen` | Node-only codegen functions |
| — testing entry | `.../testing` | Mock client & adapter |
| — cache-stores entry | `.../cache-stores` | Pluggable persistent cache stores |
| `@developerehsan/api-client-cli` | `npx @developerehsan/api-client` | Codegen CLI |
| `@developerehsan/api-client-query` | `.../query/{react,vue,solid}` | TanStack Query integration |
| `@developerehsan/api-client-vite` | `@developerehsan/api-client-vite` | Vite / TanStack Start codegen plugin |
</content>
