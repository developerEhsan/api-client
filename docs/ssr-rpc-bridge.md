# SSR RPC bridge (hide your backend from the browser)

[← Docs index](./README.md)

## The problem

In a client-side app the client runs in the browser and calls your backend
directly — the base URL and paths are visible in the Network tab by design. In
an SSR framework (Next.js, TanStack Start) you often **don't want** the browser
to see the backend **base URL**, the backend **paths**, or the **OpenAPI
document**. Importing the normal client into a **client component** ships all of
that in the JS bundle.

The bridge solves this without giving up the `api.module.method()` ergonomics.

## How it works

```text
 Browser (client component)                Server (Node / edge)
 ───────────────────────────               ─────────────────────────────
 api.products.getProductById({ id })       createRpcHandler(realApi, { expose })
   │  proxy, typed via `typeof serverApi`     │  allowlist → authorize → dispatch
   │  (type-only, erased at build)            ▼  runs the REAL client (holds secrets)
   ▼  POST same-origin { module,method,args }
 transport ───────────────────────────────▶ { ok: true, data } | { ok: false, error }
```

- The browser proxy carries **zero** runtime knowledge of URL/paths/OpenAPI —
  types come purely from `type Api = typeof serverApi`, a **type-only** import
  that is erased at build. The compiled browser bundle is a few KB and contains
  no backend host, paths, or axios.
- The server handler is the **single trust boundary**: everything the browser
  sends is treated as hostile until validated.

## Step 1 — server: the handler (holds all secrets)

```ts
// lib/api/api.config.ts  (server-only module)
import { createTypedClient } from '@developerehsan/api-client'
import { createRpcHandler } from '@developerehsan/api-client/server'
import type { OperationsMap } from './types/generated/api.types'
import { generatedModules } from './types/generated/api.modules'

export const api = createTypedClient<OperationsMap>()(
  { baseURL: process.env.API_URL!, openapi: { mode: 'runtime' } },
  generatedModules,
)
export type Api = typeof api

export const rpcHandler = createRpcHandler(api, {
  // Deny-by-default allowlist. Module AND method names autocomplete; a typo is a
  // compile error.
  expose: {
    products: ['getProductById', 'findPetsByStatus', 'addProduct'],
    store: ['getInventory'],
  },
  authorize: async (ctx, call) => {
    if (call.method === 'addProduct') return (await ctx.getCookie?.('editor')) === '1'
    return true
  },
})
```

**See it live:** the full handler — with `expose`, `maxBatchSize`, a rate limiter
on `onRequest`, an `authorize` write-gate, a `transformResult` redactor, and
`onError` logging — is in
[`examples/nextjs/lib/api/api.config.ts`](../examples/nextjs/lib/api/api.config.ts).

## Step 2 — expose it via a transport

**Option A — Next.js Server Action** (CSRF handled by Next):

```ts
// app/actions.ts
'use server'
import { createNextRpcAction } from '@developerehsan/api-client/server'
import { rpcHandler } from '@/lib/api/api.config'
export const rpc = createNextRpcAction(rpcHandler)
```

→ [`examples/nextjs/app/actions.ts`](../examples/nextjs/app/actions.ts)

**Option B — generic HTTP route** (framework-agnostic; enforces its own CSRF):

```ts
// app/api/rpc/route.ts
import { createRpcRouteHandler } from '@developerehsan/api-client/server'
import { rpcHandler } from '@/lib/api/api.config'
const handle = createRpcRouteHandler(rpcHandler)
export function POST(request: Request) { return handle(request) }
```

→ [`examples/nextjs/app/api/rpc/route.ts`](../examples/nextjs/app/api/rpc/route.ts).
Also works for TanStack Start (`createStartRpcRoute`) and Remix
(`createRemixRpcAction`).

## Step 3 — browser: the bridge client

```ts
// lib/api/rpc-client.ts
import { createRpcClient, serverActionTransport } from '@developerehsan/api-client/browser'
import type { Api } from './api.config' // ← type-only import; erased at build
import { rpc } from '@/app/actions'

export const api = createRpcClient<Api>(serverActionTransport(rpc), { batch: true })
```

→ Server-Action variant:
[`examples/nextjs/lib/api/rpc-client.ts`](../examples/nextjs/lib/api/rpc-client.ts).
Generic-HTTP variant (`httpTransport({ endpoint: '/api/rpc' })`):
[`examples/nextjs/lib/api/rpc-http-client.ts`](../examples/nextjs/lib/api/rpc-http-client.ts).

## Step 4 — call it from a client component

```tsx
'use client'
import { api } from '@/lib/api/rpc-client'
import { ApiError } from '@developerehsan/api-client/browser'

async function load() {
  try {
    const product = await api.products.getProductById({ id: 1 }) // → Product, typed
  } catch (e) {
    if (e instanceof ApiError) console.log(e.status, e.message)  // rehydrated!
  }
}
```

→ [`examples/nextjs/app/ProductDemo.tsx`](../examples/nextjs/app/ProductDemo.tsx).

## TanStack Query over the bridge

Point `createQueryIntegration` at the bridge client and the **paths-stripped**
descriptor (`api.rpc.ts`, verbs + `hasPathParams`, no paths):

```ts
import { createQueryIntegration } from '@developerehsan/api-client-query/react'
import { api } from './rpc-client'
import { rpcModules } from './types/generated/api.rpc' // no backend paths
export const q = createQueryIntegration(api, { modules: rpcModules })
```

See [TanStack Query](./tanstack-query.md#over-the-ssr-rpc-bridge).

## Batching

`createRpcClient(transport, { batch: true })` coalesces same-tick calls into one
round-trip; each sub-call is validated and authorized **individually**
server-side (`maxBatchSize`, nested-batch rejection). Both example bridge clients
enable it.

## Cancellation

Pass an `AbortSignal` as usual — `api.products.getProductById({ id }, { signal })`.
The signal is **not** sent over the wire (it isn't serializable); it's honored
locally and rejects the promise with an `AbortError` on abort.

## Security model (deny-by-default)

The handler enforces all of the following before dispatch:

| Concern | Guarantee |
| --- | --- |
| Arbitrary method calls | Deny-by-default `expose` allowlist; client strings validated, never used to index blindly |
| Prototype pollution | `__proto__`/`constructor`/`prototype` rejected in names and input |
| Authorization | Optional `authorize(ctx, call)`; deny returns the **same** error as "unknown method" (no enumeration) |
| SSRF / option injection | Client `perCall` dropped except a **clamped** `timeout`; no `baseURL`/`adapter`/`headers`/`auth` override |
| DoS | Input depth/breadth caps (`maxInputDepth`/`maxInputKeys`) + body-size cap on the HTTP route + [rate limiting](./rpc-rate-limiting.md) |
| CSRF | Server Actions: Next's built-in protection. HTTP route: POST + `application/json` + Origin/`Sec-Fetch-Site` check |
| Error leakage | Only `{ name, status, code, message }` cross the wire; stacks/URLs/headers never do (`details` only when `dev: true`) |

> The bridge client *type* mirrors your whole API surface, so
> `api.products.deleteProduct(...)` still type-checks even if it isn't exposed —
> the `expose` allowlist is the runtime gate, and an un-exposed call is denied.
</content>
