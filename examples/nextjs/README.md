# @developerehsan/api-client — Next.js (SSR RPC bridge) demo

A runnable Next.js App Router app that demonstrates the **SSR RPC bridge**: how a
**client component** can call `api.module.method()` with full type-safety while
the backend **URL, paths, and OpenAPI document never reach the browser**. Backed
by the free [DummyJSON](https://dummyjson.com) API — no backend setup needed.

> VIEW live example at [https://api-client-nextjs.vercel.app/](https://api-client-nextjs.vercel.app/)
> 📖 Feature documentation: [`../../docs/ssr-rpc-bridge.md`](../../docs/ssr-rpc-bridge.md)
> and [`../../docs/rpc-rate-limiting.md`](../../docs/rpc-rate-limiting.md).
> This README is the guided tour of _this app_.
>
> **Note:** this example uses a modified Next.js. Read
> `node_modules/next/dist/docs/` before writing Next-specific code (see
> [`AGENTS.md`](./AGENTS.md)).

## Run it

```bash
# from the monorepo root
pnpm install
pnpm --filter @developerehsan/api-client build   # build the library once

cd examples/nextjs
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and keep the **Network tab**
open — the whole point is that client-component calls show only a same-origin
`POST` carrying `{ module, method, args }`, never `dummyjson.com` or any path.

## The three routes

| Route     | File                                             | What it shows                                                          |
| --------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| `/`       | [`app/ProductDemo.tsx`](app/ProductDemo.tsx)     | The bridge from a **client component** via a Next.js **Server Action** |
| `/http`   | [`app/http/HttpDemo.tsx`](app/http/HttpDemo.tsx) | The **same** bridge via the framework-agnostic `POST /api/rpc` route   |
| `/server` | [`app/server/page.tsx`](app/server/page.tsx)     | **Direct** server-side usage (RSC) — no bridge needed, nothing leaks   |

## How it fits together

```text
Browser (client component)              Server (holds all secrets)
─────────────────────────               ─────────────────────────────────────
api.products.getProductById({ id })     lib/api/api.config.ts
  │  createRpcClient<Api>(transport)       ├─ createTypedClient(...)  ← real client
  │  Api = typeof serverApi (type-only)    └─ createRpcHandler(api, { expose, … })
  ▼  POST { module, method, args }            ▲  allowlist → rate-limit → authorize
transport ───────────────────────────────────┘  → dispatch → transformResult
```

| Piece                                                        | File                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| Real client + `createRpcHandler` (the trust boundary)        | [`lib/api/api.config.ts`](lib/api/api.config.ts)           |
| Server Action transport                                      | [`app/actions.ts`](app/actions.ts)                         |
| Generic HTTP route transport                                 | [`app/api/rpc/route.ts`](app/api/rpc/route.ts)             |
| Browser bridge client (Server Action)                        | [`lib/api/rpc-client.ts`](lib/api/rpc-client.ts)           |
| Browser bridge client (generic HTTP)                         | [`lib/api/rpc-http-client.ts`](lib/api/rpc-http-client.ts) |
| TanStack Query over the bridge (paths-stripped `rpcModules`) | [`lib/api/query.ts`](lib/api/query.ts)                     |

## Scenarios covered on `/`

Each maps to a feature in the docs:

| #   | Scenario                            | Demonstrates                                                                                 |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Direct read (`getProductById`)      | Typed call over the bridge; `images` **redacted** by `transformResult`                       |
| 2   | Direct write + authz (`addProduct`) | The `authorize` hook gates writes behind an **editor cookie**                                |
| 3   | Cancellation                        | An `AbortSignal` cancels the call **locally** (not sent over the wire)                       |
| 4   | Uniform denial (`deleteProduct`)    | A **non-exposed** method returns the _same_ generic error as an unknown one (no enumeration) |
| 5   | Batching                            | 3 calls in one tick → **one** POST; each sub-call validated individually server-side         |
| 6   | TanStack Query                      | `useQuery` through the bridge with the paths-stripped descriptor                             |
| 7   | TanStack Mutation                   | `useMutation` + cache invalidation                                                           |

## The security model (enforced server-side)

The handler in [`lib/api/api.config.ts`](lib/api/api.config.ts) wires every guard:

- **`expose`** — deny-by-default allowlist; module + method names are typed
  against `Api`, so a typo is a compile error.
- **`onRequest`** — a [`createRateLimiter`](../../docs/rpc-rate-limiting.md)
  (30 calls / 10s per session cookie) that rejects over-budget calls.
- **`authorize`** — reads open; writes (`addProduct`/`updateProduct`/
  `deleteProduct`) require a `demo_editor` cookie. A denial looks identical to an
  unknown method.
- **`transformResult`** — strips a product's bulky `images` array before it
  crosses the wire (least-privilege responses).
- **`onError`** — logs the _full_ error server-side; only
  `{ name, status, code, message }` ever reaches the browser.
- **`maxBatchSize`** — bounds RPC batching.

See the full guarantee table in
[`../../docs/ssr-rpc-bridge.md`](../../docs/ssr-rpc-bridge.md#security-model-deny-by-default).

## Try it

1. On `/`, click **Fetch product** — note the response has no `images` field.
2. Click **Try forbidden (deleteProduct)** — denied (not exposed).
3. Toggle **Become editor**, then **Add a product** — now allowed.
4. Click **Fetch #1, #2, #3 together** and watch the Network tab: **one** POST.
5. Visit `/http` for the `httpTransport` variant and `/server` for direct RSC usage.

## Regenerating types

The spec lives at [`lib/api/openapi.json`](lib/api/openapi.json):

```bash
npx @developerehsan/api-client generate \
  --input ./lib/api/openapi.json --output ./lib/api/types/generated
```

This also emits `api.rpc.ts` — the **paths-stripped** descriptor the browser
bridge + TanStack integration use so no backend path ships to the client.
</content>
