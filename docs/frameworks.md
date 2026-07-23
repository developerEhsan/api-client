# Framework & runtime guides

[← Docs index](./README.md)

## React SPA / Vite

Create the client once in `src/api.ts` (or `lib/api/api.config.ts`) and import
it. Combine with the [TanStack Query integration](./tanstack-query.md). Nothing
special required — the client runs entirely in the browser and talks to your
backend directly.

**Reference app:** [`examples/react-vite`](../examples/react-vite) — direct
client, TanStack Query, and an interactive Feature Lab.

## Next.js — App Router (RSC & Server Actions)

There are **two ways** to use the client in Next.js. Pick based on where your
backend URL is allowed to be seen:

1. **Server-only (RSC / Server Actions / route handlers)** — call the real `api`
   directly. The request happens on the server; nothing leaks. Use this for data
   you fetch during render.
   - **Do not** read `localStorage` on the server. Use `serverTokenFromCookie()`
     / `serverTenantResolver()`.
   - Wrap per-request work in `runWithTenant()` when multi-tenant.

   ```ts
   export const api = createClient({
     baseURL: process.env.API_URL!,
     openapi: { mode: 'runtime' },
     auth: { strategy: 'bearer', getToken: serverTokenFromCookie('access_token') },
     tenancy: { getTenantId: serverTenantResolver('x-tenant-id') },
   })
   ```

2. **Client components that must call the API** — do **not** import the real
   client (that would ship your base URL, backend paths, and OpenAPI into the
   browser bundle). Use the [SSR RPC bridge](./ssr-rpc-bridge.md): a client-side
   proxy with the same `api.module.method()` surface that forwards each call to a
   Server Action or route handler.

For TanStack Query prefetch/hydration, the `queryOptions` factories work in both
Server Components (prefetch + `dehydrate`) and client components
(`HydrationBoundary`); route client-component queries through the bridge client.

**Reference app:** [`examples/nextjs`](../examples/nextjs).

> **Note:** `examples/nextjs` uses a modified Next.js — read
> `examples/nextjs/node_modules/next/dist/docs/` before writing Next-specific
> code (per its `AGENTS.md`).

## TanStack Start / Remix

Both are covered by the framework-agnostic route handler:
`createStartRpcRoute` / `createRemixRpcAction` over `createRpcRouteHandler`. The
generic `httpTransport({ endpoint })` browser client works with either — see the
HTTP-transport variant in
[`examples/nextjs/lib/api/rpc-http-client.ts`](../examples/nextjs/lib/api/rpc-http-client.ts).

Vite-based projects can auto-generate the typed client with the
[Vite plugin](./codegen.md#vite-plugin-also-covers-tanstack-start).

## Node scripts / backends-for-frontends

Works out of the box with the Axios adapter. Provide a server-appropriate
`getToken` (env var, secrets manager, etc.).

## Edge runtimes (Vercel Edge, Cloudflare Workers)

Import your client normally — the library detects the edge runtime and uses the
`fetch` adapter automatically (Axios is never loaded). You can also force it:

```ts
createClient({ http: { adapter: 'fetch' }, /* ... */ })
```
</content>
