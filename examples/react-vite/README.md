# @developerehsan/api-client — React + Vite demo

A runnable demo showing the library end-to-end against the public
[Swagger Petstore](https://petstore3.swagger.io) API. It answers the most
important question: **how do the generated types connect to a working,
autocompleting client?**

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

| File | What it is | Used for |
| --- | --- | --- |
| `types/generated/api.types.ts` | `OperationsMap` — a **type** describing every operation's params/query/body/response | compile-time safety |
| `types/generated/api.modules.ts` | `generatedModules` — a **value** mapping method → `{ method, path, operationId }` | runtime dispatch |

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
api.pet.getPetById({ petId: 1 });                  // -> Promise<Pet>
api.pet.findPetsByStatus({ status: "available" }); // -> Promise<Pet[]>  (status is a typed enum)
api.store.getInventory();                           // -> Promise<Record<string, number>>
```

> **Why not `modules: { auto: true }`?** Auto-derivation of *runtime* methods
> from schema tags is not wired into `createClient`. `createTypedClient` is the
> supported bridge — explicit, debuggable, and fully typed.

### Input convention

Each method takes **one** object; the client splits it by the descriptor's path:

- path placeholders (`/pet/{petId}`) ← matching keys → `pathParams`
- a `body` key → request body
- everything else → query params

```ts
api.pet.updatePetWithForm({ petId: 1, name: "Rex" }); // petId in path, name in query
api.store.placeOrder({ body: order });                // body in the request body
```

## Regenerating types

The spec lives at [`src/lib/api/openapi.json`](src/lib/api/openapi.json).
Regenerate after it changes:

```bash
npx @developerehsan/api-client generate \
  --input ./src/lib/api/openapi.json \
  --output ./src/lib/api/types/generated
```

## What the demo shows

Three tabs (see [`src/App.tsx`](src/App.tsx)):

### 1 · Direct client — `features/DirectClientDemo.tsx`
Calling `api.*` straight from components: typed query params, typed path params,
loading/error states, and typed `ApiError` handling. Reloading the same status
is served instantly from the stale-while-revalidate cache.

### 2 · TanStack Query — `features/TanstackDemo.tsx`
The **same** client via `@tanstack/react-query`. `q.pet.queryOptions.*` and
`q.pet.mutationOptions.*` (from `lib/api/query.ts`) plug into
`useQuery`/`useMutation`. Creating a pet invalidates the list and refetches.

### 3 · Feature lab — `features/FeatureLab.tsx`
Interactive buttons, each exercising one pipeline feature, with a live log fed
by the client's events (`api.on('request' | 'response' | 'error')`):

| Button | Demonstrates |
| --- | --- |
| Caching / SWR | Second identical GET returns from cache (near-0ms) |
| Deduplication | 6 concurrent identical requests → **1** network call |
| Timeout | A 1ms per-call timeout raises `TimeoutError` |
| Cancellation | `AbortController.abort()` raises `AbortError` |
| Typed error | A bad id returns a typed `ApiError` with `status` |
| safeMode | A second client returns `{ success, error }` instead of throwing |
| Composed call | Two endpoints combined in one action |

## Configuration highlights (`api.config.ts`)

- `baseURL: https://petstore3.swagger.io/api/v3`
- `cache: { strategy: 'stale-while-revalidate', ttl: 30_000 }`
- `http.retry: { attempts: 3, backoff: 'exponential' }`
- `cancellation: { dedupeWindow: 300 }` (debounce-cancel)
- `openapi: { mode: 'runtime', runtimeURL, validation: { mode: 'loose' } }`
- `dev: { logging: true, validateResponses: true }`

## Notes

- The public Petstore occasionally returns 500 on writes (`addPet`). That is the
  demo API, not the client — you'll see the client retry, then surface a typed
  `ApiError`, which the UI displays.
- A harmless build warning mentions `node:async_hooks` being externalized: that
  is the server-only tenant-context helper, guarded so it no-ops in browsers.
- To ship without Axios in the bundle, set `http: { adapter: 'fetch' }`.
