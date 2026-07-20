# Getting started

[← Docs index](./README.md)

Build a fully-working typed client — with auth, caching, retries, timeouts, and
dedup active — in five minutes.

## Install

```bash
pnpm add @developerehsan/api-client
# npm install @developerehsan/api-client
# yarn add @developerehsan/api-client
```

Optional peer dependencies (install only what you use — nothing is bundled):

```bash
pnpm add axios   # Axios adapter (default). Skip it to run purely on fetch.
pnpm add zod     # optional; the built-in response validator needs no zod
```

Requires **TypeScript 5+** and **Node 18+** / any modern browser / edge runtime.

## Your first client

Create one file that configures and exports the client. Import it everywhere.

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

Use it anywhere:

```ts
import { api } from './src/api'

const users = await api.users.list({ page: 1 })
const user  = await api.users.get('user_42')
const made  = await api.users.create({ name: 'Ada', email: 'ada@x.com' })
```

## Run the live example

The React + Vite example does exactly this against DummyJSON and shows the
results in a UI, with dev logging printing every request/response.

```bash
# from the monorepo root
pnpm install
pnpm --filter @developerehsan/api-client build   # build the library once
cd examples/react-vite && pnpm dev
```

- Client wiring: [`examples/react-vite/src/lib/api/api.config.ts`](../examples/react-vite/src/lib/api/api.config.ts)
- Direct typed calls in a component: [`DirectClientDemo.tsx`](../examples/react-vite/src/features/DirectClientDemo.tsx)

## Two ways to build a client

| Function | When to use |
| --- | --- |
| `createClient(config)` | Quick start, hand-written modules, no OpenAPI spec needed |
| `createTypedClient<OperationsMap>()(config, generatedModules)` | Full end-to-end type-safety from an OpenAPI spec (see [codegen](./codegen.md)) |

The examples use `createTypedClient` because they generate types from a spec. The
[modules & methods](./modules-and-methods.md) page covers both.

## Where to next

- [Mental model](./mental-model.md) — understand the pipeline before going deeper
- [Modules & methods](./modules-and-methods.md) — how to declare endpoints
- [Configuration reference](./configuration.md) — every option
</content>
