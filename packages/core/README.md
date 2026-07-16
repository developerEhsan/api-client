# @developerehsan/api-client

[![npm version](https://img.shields.io/npm/v/@developerehsan/api-client.svg)](https://www.npmjs.com/package/@developerehsan/api-client)
[![npm downloads](https://img.shields.io/npm/dm/@developerehsan/api-client.svg)](https://www.npmjs.com/package/@developerehsan/api-client)
[![CI](https://github.com/developerEhsan/api-client/actions/workflows/ci.yml/badge.svg)](https://github.com/developerEhsan/api-client/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/developerEhsan/api-client/blob/master/LICENSE)
[![Types](https://img.shields.io/npm/types/@developerehsan/api-client.svg)](https://www.npmjs.com/package/@developerehsan/api-client)

> A **typed, modular, universal API client factory** for TypeScript — with a full
> request lifecycle (queue → dedup → cache → auth → retry → validate), OpenAPI
> codegen, multi-tenancy, and first-class TanStack Query support for React, Vue,
> and Solid.

Turn any HTTP/REST backend into a typed client object you call like this:

```ts
const { data } = await api.invoices.get('inv_123')
//      ^ fully typed        ^ your module   ^ your method
```

Configure one client once; every request flows through a consistent pipeline that
handles **authentication, caching, deduplication, retries, timeouts, cancellation,
multi-tenancy**, and optional **response validation** — so your UI code stays clean.
Runs in the **browser, Node, and edge runtimes** (Vercel Edge, Cloudflare Workers).

## Installation

```bash
npm install @developerehsan/api-client
# or
pnpm add @developerehsan/api-client
# or
yarn add @developerehsan/api-client
```

Optional peer dependencies (install only what you use — nothing is bundled):

```bash
pnpm add axios   # Axios adapter (default). Skip it to run purely on fetch.
pnpm add zod     # optional; the built-in response validator needs no zod
```

Requires **TypeScript 5+** and **Node 18+** / any modern browser / edge runtime.

## Quick start

```ts
// src/api.ts
import { createClient, defineModule } from '@developerehsan/api-client'

export const api = createClient({
  baseURL: 'https://api.example.com',
  openapi: { mode: 'runtime' },
  auth: { strategy: 'bearer', getToken: () => localStorage.getItem('access_token') },
  http: { timeout: 10_000, retry: { attempts: 3 } },
  cache: { strategy: 'stale-while-revalidate', ttl: 60_000 },
  modules: {
    users: defineModule({
      methods: {
        list: async (ctx, params?: { page?: number }) =>
          (await ctx.request({ method: 'GET', path: '/users', query: params })).data,
        get: async (ctx, id: string) =>
          (await ctx.request({ method: 'GET', path: '/users/{id}', pathParams: { id } })).data,
        create: async (ctx, body: { name: string; email: string }) =>
          (await ctx.request({ method: 'POST', path: '/users', body })).data,
      },
    }),
  },
})
```

```ts
import { api } from './src/api'

const users = await api.users.list({ page: 1 })
const user  = await api.users.get('user_42')
const made  = await api.users.create({ name: 'Ada', email: 'ada@x.com' })
```

That is a fully working client with auth, caching, retries, timeouts, and dedup
already active.

## Features

| Area | What you get |
| --- | --- |
| **Typed proxy** | `api.[module].[method](args)` with full input/output inference |
| **Adapters** | Axios (default) or native `fetch`; auto-fallback to `fetch` on edge |
| **Auth** | Bearer, Cookie, API key, OAuth2 (with automatic 401 → refresh → retry) |
| **Caching** | In-memory LRU, TTL, `cache-first` / `network-first` / `stale-while-revalidate`, glob invalidation |
| **Dedup** | Identical in-flight requests share one network call |
| **Retries** | Exponential/linear/fixed backoff, full-jitter, honors `Retry-After` |
| **Timeouts** | Per-request, enforced on every adapter (incl. `fetch`) |
| **Cancellation** | `AbortSignal` support + debounce-cancel |
| **Concurrency** | Global request queue with a configurable limit |
| **Multi-tenancy** | Per-call / per-module / global tenant resolution + server context |
| **Environments** | Named base URLs, switch at runtime |
| **Codegen** | Generate TS types + module descriptors from an OpenAPI 3.x spec |
| **Validation** | Runtime response validation + schema drift detection |
| **TanStack Query** | Typed `queryOptions` / `mutationOptions` / `infiniteQueryOptions` for React, Vue, Solid |
| **SSR RPC bridge** | Call `api.module.method()` from client components **without** exposing the backend URL, paths, or OpenAPI to the browser |
| **Testing** | `createMockClient` + `MockAdapter` |

## Subpath exports

| Import | Purpose |
| --- | --- |
| `@developerehsan/api-client` | The runtime library |
| `@developerehsan/api-client/codegen` | Node-only codegen functions (used by the CLI) |
| `@developerehsan/api-client/testing` | Mock client & adapter |
| `@developerehsan/api-client/server` | SSR RPC bridge — server half (`createRpcHandler`, Next/route glue) |
| `@developerehsan/api-client/browser` | SSR RPC bridge — dependency-free browser client (`createRpcClient`, transports) |

## Related packages

- [`@developerehsan/api-client-query`](https://www.npmjs.com/package/@developerehsan/api-client-query) — TanStack Query v5 integration for React, Vue, and Solid.
- [`@developerehsan/api-client-cli`](https://www.npmjs.com/package/@developerehsan/api-client-cli) — codegen CLI (`generate` / `validate` / `diff`).

## Documentation

📖 **The complete guide** — installation, every config option, auth strategies,
caching, retries, multi-tenancy, the SSR RPC bridge, TanStack Query integration,
codegen, testing, and a full API reference — lives in the
**[project README on GitHub](https://github.com/developerEhsan/api-client#readme)**.

## License

[MIT](https://github.com/developerEhsan/api-client/blob/master/LICENSE) © EHSAN
