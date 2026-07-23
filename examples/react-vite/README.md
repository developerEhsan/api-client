# @developerehsan/api-client — React + Vite demo

A runnable, client-side demo showing the library end-to-end against the free,
CORS-enabled [DummyJSON](https://dummyjson.com) API. It answers the most
important question: **how do the generated types connect to a working,
autocompleting client — and what does each pipeline feature actually do?**

> VIEW Live example at [https://api-client-react-vite.vercel.app/](https://api-client-react-vite.vercel.app/)

> 📖 Full feature documentation lives in [`../../docs`](../../docs). This README
> is the guided tour of _this app_.

## Run it

```bash
# from the monorepo root
pnpm install
pnpm --filter @developerehsan/api-client build   # build the library once

# then this example
cd examples/react-vite
pnpm dev
```

Open the app and the browser console side by side — dev logging prints every
request/response so you can watch the pipeline.

## How the pieces connect (the key idea)

Codegen produces **two** files from `openapi.json`:

| File                             | What it is                                                                           | Used for            |
| -------------------------------- | ------------------------------------------------------------------------------------ | ------------------- |
| `types/generated/api.types.ts`   | `OperationsMap` — a **type** describing every operation's params/query/body/response | compile-time safety |
| `types/generated/api.modules.ts` | `generatedModules` — a **value** mapping method → `{ method, path, operationId }`    | runtime dispatch    |

They are joined in [`src/lib/api/api.config.ts`](src/lib/api/api.config.ts):

```ts
import { createTypedClient } from "@developerehsan/api-client";
import type { OperationsMap } from "./types/generated/api.types";
import { generatedModules } from "./types/generated/api.modules";

export const api = createTypedClient<OperationsMap>()(config, generatedModules);
```

`createTypedClient` builds real callable methods from `generatedModules` and
types them with `OperationsMap`. The result autocompletes fully:

```ts
api.products.getProductById({ id: 1 }); // -> Promise<Product>
api.products.listProducts({ limit: 10, skip: 0 }); // -> Promise<ProductList>
api.auth.login({ body: { username, password } }); // -> Promise<AuthUser>
```

The config also sets `modules: { auto: true }`, which derives a callable method
for **every** tagged operation in the spec at runtime — see
[docs/schema-validation](../../docs/schema-validation.md#auto-modules-from-the-runtime-schema).

### Input convention

Each generated method takes **one** object; the client splits it by the
descriptor's path:

- path placeholders (`/products/{id}`) ← matching keys → `pathParams`
- a `body` key → request body
- everything else → query params

```ts
api.products.getProductById({ id: 1 }); // id in the path
api.products.searchProducts({ q: "phone" }); // q in the query string
api.auth.login({ body: { username, password } }); // body in the request body
```

## Regenerating types

The spec lives at [`src/lib/api/openapi.json`](src/lib/api/openapi.json).
Regenerate after it changes:

```bash
npx @developerehsan/api-client generate \
  --input ./src/lib/api/openapi.json \
  --output ./src/lib/api/types/generated
```

The included `vite.config.ts` also runs codegen automatically via the
[`@developerehsan/api-client-vite`](../../packages/vite-plugin) plugin — see
[docs/codegen](../../docs/codegen.md).

## What the demo shows

Three tabs (see [`src/App.tsx`](src/App.tsx)):

### 1 · Direct client — [`features/DirectClientDemo.tsx`](src/features/DirectClientDemo.tsx)

Calling `api.*` straight from components: typed query params, typed path params,
loading/error states, and typed `ApiError` handling. The search box uses the
300ms debounce-cancel window, so fast typing auto-aborts superseded searches.
→ [docs/getting-started](../../docs/getting-started.md),
[docs/timeouts-and-cancellation](../../docs/timeouts-and-cancellation.md).

### 2 · TanStack Query — [`features/TanstackDemo.tsx`](src/features/TanstackDemo.tsx)

The **same** client via `@tanstack/react-query`. `q.products.infiniteQueryOptions.*`
and `q.products.mutationOptions.*` (from [`lib/api/query.ts`](src/lib/api/query.ts))
plug into `useInfiniteQuery`/`useMutation`. Creating a product invalidates the
list and refetches. → [docs/tanstack-query](../../docs/tanstack-query.md).

### 3 · Feature lab — [`features/FeatureLab.tsx`](src/features/FeatureLab.tsx)

Interactive buttons, each exercising one pipeline feature, with a live log fed by
the client's events (`api.on('request' | 'response' | 'error')` — see
[`components/ui.tsx`](src/components/ui.tsx)):

| Button                | Demonstrates                                                     | Docs                                                                                   |
| --------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Caching / SWR         | Second identical GET returns from cache (near-0ms)               | [caching](../../docs/caching.md)                                                       |
| Deduplication (6→1)   | 6 concurrent identical requests → **1** network call             | [deduplication](../../docs/deduplication.md)                                           |
| Retry & backoff (500) | An always-500 endpoint retried 3× then a typed `ApiError`        | [retries](../../docs/retries.md)                                                       |
| Environments (switch) | `api.setEnvironment()` swaps the base URL + clears the cache     | [environments](../../docs/environments.md)                                             |
| Timeout (1ms)         | A 1ms per-call timeout raises `TimeoutError`                     | [timeouts](../../docs/timeouts-and-cancellation.md)                                    |
| Cancellation          | `AbortController.abort()` raises `AbortError`                    | [cancellation](../../docs/timeouts-and-cancellation.md)                                |
| Typed error (404)     | A bad id returns a typed `ApiError` with `status`                | [errors](../../docs/responses-and-errors.md)                                           |
| safeMode result       | A second client returns `{ success, error }` instead of throwing | [safeMode](../../docs/responses-and-errors.md#safemode-no-throw)                       |
| Composed call         | Two endpoints combined in one method                             | [modules](../../docs/modules-and-methods.md#composed-calls-calling-multiple-endpoints) |
| ctx.run (analytics)   | Non-HTTP module logic with opt-in dedup + retry                  | [modules-beyond-http](../../docs/modules-beyond-http.md)                               |

## Configuration highlights (`api.config.ts`)

- `baseURL: https://dummyjson.com` + an `environments` map (`primary` / `mirror`)
- `auth: { strategy: 'bearer', getToken, onMissingToken: 'skip' }` — `auth.login` persists the token
- `cache: { strategy: 'stale-while-revalidate', ttl: 30_000 }`
- `http.retry: { attempts: 3, backoff: 'exponential', baseDelay: 400 }`
- `http.queue: { concurrency: 6 }`
- `cancellation: { dedupeWindow: 300 }` (debounce-cancel)
- `openapi: { mode: 'runtime', validation: { enabled: true, mode: 'loose' } }`
- `dev: { logging: true, validateResponses: true }`
- Custom modules: `products.getWithSiblings` (composed), `analytics.summarize`
  (`ctx.run`), `debug.failing` (retry demo)

## Notes

- A harmless build warning mentions `node:async_hooks` being externalized: that
  is the server-only tenant-context helper, guarded so it no-ops in browsers.
- To ship without Axios in the bundle, set `http: { adapter: 'fetch' }`.
  </content>
