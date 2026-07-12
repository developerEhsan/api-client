# @developerEhsan/api-client

> A typed, modular, universal API client factory for TypeScript — with a full
> request lifecycle (queue → dedup → cache → auth → retry → validate), OpenAPI
> codegen, multi-tenancy, and first-class TanStack Query support for React, Vue,
> and Solid.

This is the complete guide. It starts from zero and walks through **every**
feature. If you have never used the library before, read top to bottom once —
after that you can jump straight to the reference tables.

---

## Table of contents

1. [What is this library?](#1-what-is-this-library)
2. [Mental model (read this first)](#2-mental-model-read-this-first)
3. [Installation](#3-installation)
4. [Your first client in 5 minutes](#4-your-first-client-in-5-minutes)
5. [Defining modules and methods](#5-defining-modules-and-methods)
6. [Making calls & the response envelope](#6-making-calls--the-response-envelope)
7. [Configuration reference](#7-configuration-reference)
8. [Authentication](#8-authentication)
9. [Caching](#9-caching)
10. [Deduplication](#10-deduplication)
11. [Retries & backoff](#11-retries--backoff)
12. [Timeouts & cancellation](#12-timeouts--cancellation)
13. [Concurrency queue](#13-concurrency-queue)
14. [Multi-tenancy](#14-multi-tenancy)
15. [Multiple environments & base URLs](#15-multiple-environments--base-urls)
16. [Error handling](#16-error-handling)
17. [Hooks & events](#17-hooks--events)
18. [Code generation (CLI)](#18-code-generation-cli)
19. [Runtime schema validation & drift detection](#19-runtime-schema-validation--drift-detection)
20. [TanStack Query — React](#20-tanstack-query--react)
21. [TanStack Query — Vue](#21-tanstack-query--vue)
22. [TanStack Query — Solid](#22-tanstack-query--solid)
23. [Framework & runtime guides](#23-framework--runtime-guides)
24. [Testing your code](#24-testing-your-code)
25. [Full public API reference](#25-full-public-api-reference)
26. [Troubleshooting & FAQ](#26-troubleshooting--faq)

---

## 1. What is this library?

`@developerEhsan/api-client` turns an HTTP/REST backend into a **typed, ergonomic
client object** you call like this:

```ts
const { data } = await api.invoices.get('inv_123')
//      ^ fully typed        ^ your module   ^ your method
```

Instead of scattering `fetch`/`axios` calls across your app, you configure one
client once. Every request then flows through a consistent **pipeline** that
handles authentication, caching, deduplication, retries, timeouts,
cancellation, multi-tenancy, and (optionally) response validation — so your UI
code stays clean.

### Feature overview

| Area | What you get |
| --- | --- |
| **Typed proxy** | `api.[module].[method](args)` with full input/output inference |
| **Adapters** | Axios (default) or native `fetch`; auto-fallback to `fetch` on edge |
| **Auth** | Bearer, Cookie, API key, OAuth2 (with automatic 401→refresh→retry) |
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
| **Testing** | `createMockClient` + `MockAdapter` |

### Packages

| Package | Import | Purpose |
| --- | --- | --- |
| `@developerEhsan/api-client` | `@developerEhsan/api-client` | The runtime library |
| — codegen entry | `@developerEhsan/api-client/codegen` | Node-only codegen functions (used by the CLI) |
| — testing entry | `@developerEhsan/api-client/testing` | Mock client & adapter |
| `@developerEhsan/api-client-cli` | `npx @developerEhsan/api-client` | Codegen CLI |
| `@developerEhsan/api-client-query` | `.../query/react` \| `/vue` \| `/solid` | TanStack Query integration |

---

## 2. Mental model (read this first)

There are exactly **three concepts** to understand.

**1. The client** — created once with `createClient(config)`. It holds all your
global settings and the shared state (cache, dedup map, queue).

**2. Modules & methods** — you group endpoints into *modules* (e.g. `invoices`,
`users`) and declare *methods* on them with `defineModule`. Each method uses the
`ctx.request(...)` primitive to actually perform an HTTP call. Method names and
paths are yours to choose.

**3. The pipeline** — every `ctx.request(...)` runs through this ordered
lifecycle:

```
your call
   │
   ▼
 resolve config  (global → module → per-call, deep-merged)
   │
   ▼
 concurrency queue ──▶ deduplication ──▶ cache lookup
   │                                        │ (hit? return)
   ▼                                        ▼ (miss)
 resolve tenant + auth headers
   │
   ▼
 dispatch (with timeout) ──▶ retry on 5xx/network/timeout
   │                           │
   │                           └─ 401? → refresh token → retry once
   ▼
 validate response (optional) ──▶ write cache ──▶ return ApiResponse<T>
```

> **Codegen vs. runtime.** The CLI generates **types** and a **module
> descriptor map** from your OpenAPI spec. Those give you compile-time safety
> and feed the TanStack integration. The actual runtime *methods* you call are
> the ones you declare with `defineModule` — usually thin wrappers over
> `ctx.request(...)` that reference the generated paths. This keeps runtime
> behavior explicit and debuggable.

---

## 3. Installation

```bash
# pick your package manager
pnpm add @developerEhsan/api-client
npm  install @developerEhsan/api-client
yarn add @developerEhsan/api-client
```

### Optional peer dependencies

Install only what you use — none are bundled, so unused ones add zero bytes:

```bash
# Axios adapter (default adapter). Skip it to run purely on fetch.
pnpm add axios

# Runtime response validation helpers you might call directly.
pnpm add zod        # optional; the built-in validator needs no zod

# TanStack Query integration (choose your framework)
pnpm add @developerEhsan/api-client-query @tanstack/react-query
pnpm add @developerEhsan/api-client-query @tanstack/vue-query
pnpm add @developerEhsan/api-client-query @tanstack/solid-query
```

### Requirements

- TypeScript 5+ (strict mode recommended)
- Node 18+ / any modern browser / edge runtimes (Vercel Edge, Cloudflare Workers)

---

## 4. Your first client in 5 minutes

Create one file that configures and exports the client. Import this everywhere.

```ts
// src/api.ts
import { createClient, defineModule } from '@developerEhsan/api-client'

export const api = createClient({
  // Where your API lives.
  baseURL: 'https://api.example.com',

  // The library can work with or without an OpenAPI spec. In 'runtime' mode it
  // can fetch the spec for validation; in 'codegen' mode you generate types
  // ahead of time. Start simple:
  openapi: { mode: 'runtime' },

  // How to authenticate (see §8 for all strategies).
  auth: {
    strategy: 'bearer',
    getToken: () => localStorage.getItem('access_token'),
  },

  // Sensible defaults for the whole app.
  http: { timeout: 10_000, retry: { attempts: 3 } },
  cache: { strategy: 'stale-while-revalidate', ttl: 60_000 },

  // Declare your modules (see §5).
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

Now use it anywhere:

```ts
import { api } from './src/api'

const users = await api.users.list({ page: 1 })
const user  = await api.users.get('user_42')
const made  = await api.users.create({ name: 'Ada', email: 'ada@x.com' })
```

That is a fully working client with auth, caching, retries, timeouts, and dedup
already active.

---

## 5. Defining modules and methods

A **module** is a named group of methods. You declare it with `defineModule`,
whose `methods` each receive a **`ctx`** (module context) as their first
argument. Callers never pass `ctx` — it is injected for you:

```ts
defineModule({
  methods: {
    // You write:  (ctx, ...yourArgs)
    // Callers use: api.invoices.get(id, perCall?)
    get: async (ctx, id: string, perCall?) =>
      (await ctx.request(
        { method: 'GET', path: '/invoices/{id}', pathParams: { id } },
        perCall,
      )).data,
  },
})
```

### `ctx.request(spec, perCall?)`

The one primitive that runs the pipeline.

```ts
interface ModuleRequestSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  path: string                              // supports {placeholders}
  pathParams?: Record<string, string | number>
  query?: Record<string, unknown>           // serialized to the query string
  body?: unknown                            // JSON-serialized for you
}

// Returns Promise<ApiResponse<T>> — see §6.
ctx.request<T>(spec, perCall?): Promise<ApiResponse<T>>
```

- **Path params:** `path: '/orders/{orderId}/lines/{lineId}'` +
  `pathParams: { orderId, lineId }`. A missing required placeholder throws a
  `ConfigurationError` before any network call.
- **Query:** `query: { page: 1, tags: ['a', 'b'] }` →
  `?page=1&tags=a&tags=b`. `undefined`/`null` values are skipped.
- **Per-call overrides:** pass a second argument to override config for just
  this call (see §7.3).

### Typing responses

Annotate the generic so callers get typed results:

```ts
type Invoice = { id: string; amount: number; status: 'draft' | 'paid' }

list: async (ctx): Promise<Invoice[]> =>
  (await ctx.request<Invoice[]>({ method: 'GET', path: '/invoices' })).data,
```

If you use the codegen (see §18), import the generated types instead of writing
them by hand.

### Composed calls (calling multiple endpoints)

A method can perform several requests and combine them. Access other modules via
`ctx.client`:

```ts
getWithLines: async (ctx, id: string) => {
  const invoice = (await ctx.request({ method: 'GET', path: '/invoices/{id}', pathParams: { id } })).data
  const lines   = (await ctx.request({ method: 'GET', path: '/invoices/{id}/lines', pathParams: { id } })).data
  return { invoice, lines }
},
```

### Module-level configuration & extension

```ts
defineModule({
  config: {
    baseURL: 'https://payroll.internal',   // this module hits a different host
    timeout: 30_000,
    auth: { strategy: 'apiKey', getKey: () => process.env.PAYROLL_KEY!, placement: 'header', name: 'X-Key' },
  },
  methods: { /* ... */ },
})
```

---

## 6. Making calls & the response envelope

Your module methods return whatever you return from them (above we returned
`.data`). Internally `ctx.request` resolves to an **`ApiResponse<T>`**:

```ts
interface ApiResponse<T> {
  data: T                              // parsed body (null for 204/empty)
  status: number                       // HTTP status
  statusText?: string
  headers: Record<string, string>      // response headers
  fromCache?: boolean                  // true when served from cache
}
```

Return `.data` for a clean API, or return the whole envelope if callers need
status/headers:

```ts
getRaw: async (ctx, id: string) =>
  ctx.request<Invoice>({ method: 'GET', path: '/invoices/{id}', pathParams: { id } }),
// caller: const { data, status, fromCache } = await api.invoices.getRaw('1')
```

Failures **throw** typed errors by default (see §16), or return a discriminated
result if you enable [`safeMode`](#164-safemode-no-throw).

---

## 7. Configuration reference

Configuration comes in three layers and is **deep-merged** in this order (later
wins):

```
library defaults  →  global config  →  module config  →  per-call config
```

Arrays (e.g. header sets) are merged, not replaced.

### 7.1 Global config (`createClient(config)`)

```ts
interface GlobalConfig {
  baseURL: string
  environments?: Record<string, string>   // named base URLs (see §15)
  activeEnvironment?: string

  openapi: {
    mode?: 'codegen' | 'runtime' | 'auto'  // default 'auto'
    schemaPath?: string                     // for codegen
    runtimeURL?: string                     // fetch spec at runtime (dev)
    validation?: {
      enabled?: boolean
      mode?: 'strict' | 'loose'             // throw vs. warn
      onDriftDetected?: (diff) => void
    }
  }

  http?: {
    adapter?: 'axios' | 'fetch' | HttpAdapter   // default 'axios'
    timeout?: number                             // ms, default 10_000
    headers?: Record<string, string>
    deduplication?: boolean                      // default true
    dedupeMethod?: string[]                      // default ['GET']
    queue?: { enabled?: boolean; concurrency?: number; priority?: 'fifo' | 'lifo' }
    retry?: {
      attempts?: number                          // default 3
      backoff?: 'exponential' | 'linear' | 'fixed'
      baseDelay?: number; maxDelay?: number      // ms
      jitter?: boolean                           // default true (full-jitter)
      retryOn?: (error: ApiError) => boolean
      onRetry?: (attempt: number, error: ApiError) => void
    }
  }

  auth?: AuthConfig                              // see §8
  cache?: CacheConfig                            // see §9
  cancellation?: { dedupeWindow?: number; cancelOnUnmount?: boolean }
  tenancy?: { headerName?: string; getTenantId?: () => string | Promise<string> }
  dev?: { logging?: boolean | 'verbose'; validateResponses?: boolean; schemaRefreshInterval?: number }
  hooks?: LifecycleHooks                         // see §17
  safeMode?: boolean                             // see §16.4
  modules?: Record<string, ModuleDefinition>
}
```

### 7.2 Module config

Set on a module via `defineModule({ config: { ... } })`. Supported keys:
`baseURL`, `timeout`, `headers`, `auth`, `cache`, `retry`, `tenancy`,
`validation`. Each overrides the global value for that module only.

### 7.3 Per-call config

Pass as the last argument through your method to `ctx.request(spec, perCall)`:

```ts
interface PerCallConfig {
  signal?: AbortSignal                 // cancellation
  headers?: Record<string, string>
  tenantId?: string                    // override tenant for this call
  cache?: { enabled?: boolean; ttl?: number; bust?: boolean }
  retry?: { attempts?: number }
  timeout?: number
  skipAuth?: boolean                   // send unauthenticated
  skipDedup?: boolean
  responseType?: 'json' | 'blob' | 'text' | 'arraybuffer'
}
```

Example:

```ts
await api.users.get('42', { timeout: 2000, cache: { bust: true } })
```

---

## 8. Authentication

Set `auth` globally, per module, or per call. Four strategies plus "none".

### 8.1 Bearer token

```ts
auth: {
  strategy: 'bearer',
  getToken: () => localStorage.getItem('access_token'),   // sync or async
  headerName: 'Authorization',   // default
  prefix: 'Bearer',              // default
  onMissingToken: 'warn',        // 'throw' | 'skip' | 'warn' (default 'warn')
}
```

- `getToken` may be async (e.g. read from secure storage).
- If it returns `null`: `warn` sends the request unauthenticated, `skip` sends
  without the header silently, `throw` raises an `AuthError`.
- If it throws, the request is not sent and an `AuthError` is raised.

### 8.2 Cookie (browser session)

```ts
auth: { strategy: 'cookie' }   // sends credentials: 'include' automatically
```

Make sure your server sends `Access-Control-Allow-Credentials: true`.

### 8.3 API key (header or query)

```ts
auth: {
  strategy: 'apiKey',
  getKey: () => process.env.API_KEY!,
  placement: 'header',   // or 'query'
  name: 'X-API-Key',     // header name or query-param name
}
```

### 8.4 OAuth2 with automatic refresh

Handles the full **401 → refresh → retry-once** flow, and coalesces concurrent
401s so only **one** refresh runs at a time (per config):

```ts
auth: {
  strategy: 'oauth2',
  getAccessToken:  () => tokenStore.access,
  getRefreshToken: () => tokenStore.refresh,
  refreshEndpoint: 'https://api.example.com/oauth/token',
  // Optional: shape the refresh request body.
  refreshPayload: (refreshToken) => ({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  // Called on success — persist the new tokens here.
  onTokensRefreshed: (tokens) => { tokenStore.access = tokens.accessToken; if (tokens.refreshToken) tokenStore.refresh = tokens.refreshToken },
  // Called when refresh fails — usually redirect to login.
  onRefreshFailed: (error) => { redirectToLogin() },
  concurrentRefreshStrategy: 'queue',  // 'queue' (default) or 'race'
}
```

The refresh response is expected to contain `access_token`/`accessToken` (and
optionally `refresh_token`/`refreshToken`). A second 401 after refreshing is
**not** re-refreshed (prevents infinite loops).

### 8.5 Per-call: skip auth

```ts
await api.public.getStatus(undefined, { skipAuth: true })
```

### 8.6 Server-side auth (Next.js RSC)

Never read `localStorage` on the server. Use the provided helper:

```ts
import { serverTokenFromCookie } from '@developerEhsan/api-client'

auth: { strategy: 'bearer', getToken: serverTokenFromCookie('access_token') }
```

---

## 9. Caching

Caching applies to **GET** requests. Configure globally, per module, or per call.

```ts
cache: {
  enabled: true,                         // default true
  strategy: 'stale-while-revalidate',    // see below
  ttl: 60_000,                           // ms until an entry is stale
  maxSize: 500,                          // LRU capacity
  onEvict: (key, entry) => {},           // optional
}
```

### Strategies

| Strategy | Behavior |
| --- | --- |
| `cache-first` (default) | Return a fresh entry if present; otherwise fetch and cache. |
| `network-first` | Try the network; on failure fall back to a cached entry if one exists. |
| `stale-while-revalidate` | Return a stale entry **immediately**, revalidate in the background, keep the stale copy if revalidation fails. |

### Cache keys are safe by construction

Keys include the HTTP method, URL, tenant id, **and an auth fingerprint** — so
two users with different tokens never share a cached response.

### Invalidation & busting

```ts
api.cache.get(key)          // read a raw entry
api.cache.clear()           // wipe everything
api.cache.invalidate('users.*')   // glob invalidation (* wildcard)

// Per call: skip the cache and refresh it.
await api.users.list(params, { cache: { bust: true } })
```

### Cache events / hooks

```ts
createClient({
  hooks: {
    onCacheHit:  (key, entry) => {},
    onCacheMiss: (key) => {},
  },
})
// or: api.on('cacheHit', ({ key, entry }) => {})
```

---

## 10. Deduplication

Identical in-flight requests are collapsed into **one** network call; every
caller receives the same result (or the same error). On by default for `GET`.

```ts
http: {
  deduplication: true,        // default
  dedupeMethod: ['GET'],      // add 'POST' etc. to dedupe those too
}

// Opt out for a single call:
await api.users.get('42', undefined, { skipDedup: true })
```

Dedup keys include the auth fingerprint and tenant, so requests with different
credentials are never merged.

---

## 11. Retries & backoff

Failed requests are retried when they are **retryable** (5xx, 429, network, and
timeout errors by default).

```ts
http: {
  retry: {
    attempts: 3,                 // total tries
    backoff: 'exponential',      // 'exponential' | 'linear' | 'fixed'
    baseDelay: 500,              // ms
    maxDelay: 30_000,            // ms — hard ceiling (also caps Retry-After)
    jitter: true,                // full-jitter to avoid thundering herds
    retryOn: (error) => error.status === 503,   // custom predicate
    onRetry: (attempt, error) => console.warn('retry', attempt, error.status),
  },
}
```

- A `429`/`503` with a `Retry-After` header is honored (seconds **or**
  HTTP-date), but never longer than `maxDelay`.
- Backoff waits are **abort-interruptible** — cancelling stops the wait
  immediately.
- 4xx (except 401 handled by auth) are **not** retried by default.

---

## 12. Timeouts & cancellation

### Timeouts

Set `http.timeout` (or per call). Enforced on **every** adapter — including
`fetch`, which does not time out on its own. Exceeding it raises a
`TimeoutError` (which is retryable). Each retry attempt gets a fresh budget.

```ts
await api.reports.generate(input, { timeout: 60_000 })
```

### Cancellation with AbortSignal

```ts
const controller = new AbortController()
const promise = api.users.list(params, { signal: controller.signal })
controller.abort()   // rejects with an AbortError; no further retries
```

`AbortError`s propagate to the caller as-is (they are never swallowed or turned
into cache hits), even under `safeMode`.

### Debounce-cancel (typeahead)

Set `cancellation.dedupeWindow` so a newer call for the same endpoint within the
window auto-cancels the previous in-flight one:

```ts
createClient({ cancellation: { dedupeWindow: 300 } })
// Rapid api.search.query('a'), ('ab'), ('abc') — earlier ones are aborted.
```

---

## 13. Concurrency queue

Limit how many requests are in flight at once (useful against rate limits):

```ts
http: {
  queue: {
    enabled: true,        // default
    concurrency: 6,       // max simultaneous requests (default 10)
    priority: 'fifo',     // 'fifo' (default) or 'lifo'
  },
}
```

Requests beyond the limit wait their turn. Aborting a queued (not-yet-started)
request removes it from the queue and rejects it.

---

## 14. Multi-tenancy

Inject a tenant id header, resolved with this precedence:

```
per-call tenantId  →  configured getTenantId()  →  ambient server context
```

```ts
createClient({
  tenancy: {
    headerName: 'X-Tenant-ID',            // default
    getTenantId: () => currentTenant.id,  // sync or async
  },
})

// Per-call override:
await api.invoices.list(params, { tenantId: 'acme' })
```

If nothing resolves, no tenant header is sent (tenant-agnostic endpoints are
fine). If `getTenantId` throws, a `ConfigurationError` is raised before the call.

Cache/dedup keys include the tenant id, so tenants never see each other's data.

### Server-side (Next.js RSC / concurrent requests)

`AsyncLocalStorage` keeps concurrent server requests isolated:

```ts
import { runWithTenant, getTenantFromContext, serverTenantResolver } from '@developerEhsan/api-client'

// Configure the resolver to read the ambient context (or a request header):
createClient({ tenancy: { getTenantId: getTenantFromContext } })
// or read a request header directly:
createClient({ tenancy: { getTenantId: serverTenantResolver('x-tenant-id') } })

// Wrap per-request server work so each request has its own tenant:
export async function handler(tenantId: string) {
  return runWithTenant(tenantId, async () => {
    return api.invoices.list()   // sees `tenantId`, isolated from other requests
  })
}
```

---

## 15. Multiple environments & base URLs

```ts
createClient({
  environments: {
    dev:     'http://localhost:3000',
    staging: 'https://staging.example.com',
    prod:    'https://api.example.com',
  },
  activeEnvironment: 'dev',   // picks the base URL; must exist in the map
  openapi: { mode: 'runtime' },
})

// Switch at runtime — this also clears the cache:
api.setEnvironment('staging')
```

- An unknown `activeEnvironment` throws a `ConfigurationError` at
  `createClient` time (fail fast).
- A module can target a different host with `config.baseURL` (see §5).

---

## 16. Error handling

### 16.1 Typed error classes

Every failure is one of these (all extend `ApiError`):

| Class | When |
| --- | --- |
| `ApiError` | Base; also used for generic 4xx/5xx. Has `status`, `code`, `serverError`, `rawBody`, `retryCount`, `responseHeaders`. |
| `NetworkError` | No response (offline, DNS, CORS). Flags: `corsBlocked`, `offline`, `partial`. |
| `TimeoutError` | Exceeded the configured timeout. Has `timeoutMs`. |
| `AuthError` | 401 with no/failed refresh, or token getter failure. |
| `SchemaError` | Response validation failed (strict) or drift detected. |
| `SchemaParseError` | Malformed/unsupported OpenAPI spec (codegen/parse). |
| `ConfigurationError` | Bad config, missing path param, failing tenant resolver. |

```ts
import { ApiError, AuthError, TimeoutError } from '@developerEhsan/api-client'

try {
  await api.users.get('42')
} catch (err) {
  if (err instanceof AuthError) redirectToLogin()
  else if (err instanceof TimeoutError) toast('Timed out, retry?')
  else if (err instanceof ApiError) console.error(err.status, err.serverError)
}
```

### 16.2 Structured vs. unstructured server errors

- `{ code, message, details }` bodies are parsed into `error.serverError`.
- Non-JSON bodies (e.g. an HTML 5xx page) are kept in `error.rawBody`; the
  `error.message` is a short, truncated hint (never the whole document).

### 16.3 Error hooks

```ts
createClient({ hooks: { onError: (error) => reportToSentry(error) } })
```

### 16.4 `safeMode` (no-throw)

Return a discriminated union instead of throwing:

```ts
createClient({ safeMode: true })

const result = await api.users.get('42')
if (result.success) use(result.data)
else handle(result.error)   // result.error is an ApiError
```

(`AbortError`s still throw even in `safeMode`, so cancellation stays observable.)

---

## 17. Hooks & events

### Lifecycle hooks (config)

```ts
createClient({
  hooks: {
    onRequest:  (req) => ({ ...req, headers: { ...req.headers, 'X-Trace': id() } }),
    onResponse: (res) => res,
    onError:    (err) => log(err),
    onRetry:    (attempt, err) => {},
    onCacheHit: (key, entry) => {},
    onCacheMiss:(key) => {},
  },
})
```

`onRequest`/`onResponse` may transform (and must return) their argument.

### Event emitter (imperative)

```ts
const handler = (payload) => {}
api.on('request', handler)     // 'request' | 'response' | 'error' | 'cacheHit' | 'cacheMiss'
api.off('request', handler)
```

### Dev logging

```ts
createClient({ dev: { logging: 'verbose' } })   // true | 'verbose' | false
```

---

## 18. Code generation (CLI)

Generate TypeScript types and a module descriptor map from an OpenAPI 3.x spec.

```bash
# Generate types + descriptors
npx @developerEhsan/api-client generate \
  --input ./openapi.json \
  --output ./src/generated \
  --base-url https://api.example.com

# Re-generate on change
npx @developerEhsan/api-client generate --watch

# Validate a spec (CI-friendly; no file writes)
npx @developerEhsan/api-client validate --input ./openapi.json

# Show what changed since the last generation
npx @developerEhsan/api-client diff --input ./openapi.json --output ./src/generated
```

### Generated files

```
src/generated/
├── api.types.ts      # interfaces + an OperationsMap (DO NOT EDIT)
├── api.modules.ts    # `generatedModules` descriptor map (DO NOT EDIT)
├── api.schema.hash   # spec hash for drift detection
└── overrides/        # put your custom type augmentations here (safe to edit)
```

Use the generated **types** for your method signatures, and the generated
**`generatedModules`** descriptor with the TanStack integration (§20–22). The
parser handles `$ref`, `allOf`/`oneOf`/`anyOf`, `nullable`, enums, and circular
references.

---

## 19. Runtime schema validation & drift detection

In `runtime` mode the client can fetch your spec and validate responses against
it — great for catching backend drift in development.

```ts
createClient({
  openapi: {
    mode: 'runtime',
    runtimeURL: 'https://api.example.com/openapi.json',
    validation: {
      enabled: true,
      mode: 'loose',   // 'loose' warns; 'strict' throws a SchemaError
      onDriftDetected: (diff) => console.warn('schema drift', diff),
    },
  },
  dev: { schemaRefreshInterval: 30_000 },   // re-fetch + diff periodically
})

api.getSchema()   // the loaded SchemaAST (or undefined before it loads)
```

- Validation is **dependency-free** (no `zod` required); it checks bodies
  structurally, including enums, unions, `$ref`s, and `additionalProperties`.
- If a refresh fails, the last known-good schema is kept.
- Drift detection compares operation signatures **and body/response types**.

---

## 20. TanStack Query — React

Install `@developerEhsan/api-client-query` and `@tanstack/react-query`, then build
an integration from your client + a descriptor map (the generated
`generatedModules`, or a hand-written one).

```tsx
// query.ts
import { createQueryIntegration } from '@developerEhsan/api-client-query/react'
import { generatedModules } from './generated/api.modules'   // or a manual map
import { api } from './api'

export const q = createQueryIntegration(api, { modules: generatedModules })
```

```tsx
// UsersPage.tsx
import { useQuery, useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { q } from './query'

function UsersPage() {
  const queryClient = useQueryClient()

  // Query
  const { data, isLoading } = useQuery(q.users.queryOptions.list({ page: 1 }))

  // Mutation + cache invalidation
  const create = useMutation(
    q.users.mutationOptions.create({
      onSuccess: () => q.users.invalidateQueries(queryClient),
    }),
  )

  // Infinite query (auto-detected for paginated endpoints)
  const infinite = useInfiniteQuery(q.users.infiniteQueryOptions.list({ limit: 20 }))

  return null
}
```

- **Query keys** are stable & hierarchical: `['developerEhsan', module, method, params]`.
- Passing `null`/`undefined` params to a query that needs them sets
  `enabled: false` automatically (dependent queries).
- The `AbortSignal` from TanStack is forwarded into the pipeline, so unmounting
  cancels the request.

Manual descriptor map (if you are not using codegen):

```ts
const modules = {
  users: {
    list:   { method: 'GET',  path: '/users', isPaginated: true },
    get:    { method: 'GET',  path: '/users/{id}' },
    create: { method: 'POST', path: '/users' },
  },
}
export const q = createQueryIntegration(api, { modules })
```

---

## 21. TanStack Query — Vue

Same integration, imported from the `/vue` entry. The option objects plug
directly into `@tanstack/vue-query`.

```ts
// query.ts
import { createQueryIntegration } from '@developerEhsan/api-client-query/vue'
import { generatedModules } from './generated/api.modules'
import { api } from './api'

export const q = createQueryIntegration(api, { modules: generatedModules })
```

```vue
<script setup lang="ts">
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { q } from './query'

const queryClient = useQueryClient()

const { data, isLoading } = useQuery(q.users.queryOptions.list({ page: 1 }))

const create = useMutation(
  q.users.mutationOptions.create({
    onSuccess: () => q.users.invalidateQueries(queryClient),
  }),
)
</script>
```

> Note: with Vue Query you typically pass reactive params. Call the factory with
> the current values inside a computed if you need reactivity, e.g.
> `computed(() => q.users.queryOptions.list({ page: page.value }))`.

---

## 22. TanStack Query — Solid

Import from the `/solid` entry; use with `@tanstack/solid-query`.

```tsx
// query.ts
import { createQueryIntegration } from '@developerEhsan/api-client-query/solid'
import { generatedModules } from './generated/api.modules'
import { api } from './api'

export const q = createQueryIntegration(api, { modules: generatedModules })
```

```tsx
import { useQuery, useMutation } from '@tanstack/solid-query'
import { q } from './query'

function Users() {
  const query = useQuery(() => q.users.queryOptions.list({ page: 1 }))
  const create = useMutation(() => q.users.mutationOptions.create())
  return null
}
```

> Solid Query expects a function returning the options object, so wrap the
> factory call in an arrow: `useQuery(() => q.users.queryOptions.list(params))`.

---

## 23. Framework & runtime guides

### React SPA / Vite

Create the client once in `src/api.ts` and import it. Combine with the React
Query integration (§20). Nothing special required.

### Next.js — App Router (RSC & Server Actions)

- **Do not** read `localStorage` on the server. Use `serverTokenFromCookie()` /
  `serverTenantResolver()`.
- Wrap per-request work in `runWithTenant()` when multi-tenant.
- Prefetch in a Server Component and hydrate on the client with TanStack's
  `dehydrate`/`HydrationBoundary` — the `queryOptions` factories work in both.

```ts
// server-safe client
export const api = createClient({
  baseURL: process.env.API_URL!,
  openapi: { mode: 'runtime' },
  auth: { strategy: 'bearer', getToken: serverTokenFromCookie('access_token') },
  tenancy: { getTenantId: serverTenantResolver('x-tenant-id') },
})
```

### Node scripts / backends-for-frontends

Works out of the box with the Axios adapter. Provide a server-appropriate
`getToken` (env var, secrets manager, etc.).

### Edge runtimes (Vercel Edge, Cloudflare Workers)

Import your client normally — the library detects the edge runtime and uses the
`fetch` adapter automatically (Axios is never loaded). You can also force it:

```ts
createClient({ http: { adapter: 'fetch' }, /* ... */ })
```

---

## 24. Testing your code

Use the built-in mock client — no real network, full pipeline.

```ts
import { createMockClient } from '@developerEhsan/api-client/testing'
import { defineModule } from '@developerEhsan/api-client'

const { api, mock } = createMockClient({
  modules: {
    users: defineModule({
      methods: {
        get: async (ctx, id: string) =>
          (await ctx.request({ method: 'GET', path: '/users/{id}', pathParams: { id } })).data,
      },
    }),
  },
})

// Register responses (by method + URL substring, or a function responder):
mock.on('GET', '/users/1', { data: { id: '1', name: 'Ada' } })
mock.on('GET', '/users/', (req) => ({ status: 404, data: { message: 'not found' } }))

// Act + assert:
const user = await api.users.get('1')
expect(user).toEqual({ id: '1', name: 'Ada' })
expect(mock.callsTo('GET', '/users/1')).toHaveLength(1)
```

`createMockClient` defaults to instant retries (no delays) for fast tests. You
can also use `createMockAdapter()` directly with a real `createClient`.

---

## 25. Full public API reference

### `@developerEhsan/api-client`

**Factory**

- `createClient(config: GlobalConfig): ApiClient`
- `defineModule({ config?, methods, extends? }): ModuleDefinition`

**Client instance members**

- `api.[module].[method](...args)` — your declared methods
- `api.cache.get(key)` / `.clear()` / `.invalidate(pattern?)`
- `api.config.get()` / `.update(partial)`
- `api.setEnvironment(name)`
- `api.getSchema()`
- `api.on(event, handler)` / `api.off(event, handler)`

**Errors**

`ApiError`, `NetworkError`, `TimeoutError`, `AuthError`, `SchemaError`,
`SchemaParseError`, `ConfigurationError`, `classifyError`, `extractServerError`

**Adapters**

`createFetchAdapter()`, `createAxiosAdapter(instance?)`, `detectEnvironment()`,
type `HttpAdapter`

**Auth**

`createAuthManager(deps)`, and config types
`BearerAuthConfig` / `CookieAuthConfig` / `ApiKeyAuthConfig` / `OAuth2AuthConfig`

**Tenancy & server context**

`runWithTenant(id, fn)`, `getTenantFromContext()`, `hasTenantContext()`,
`resolveTenantId(input)`, `readServerHeader(name)`, `readServerCookie(name)`,
`serverTenantResolver(headerName?)`, `serverTokenFromCookie(cookieName?)`

**Runtime schema**

`createSchemaCache()`, `createSchemaLoader(deps)`, `diffSchemas(a, b)`,
`hashSchema(ast)`, `hasDrift(diff)`, `handleDrift(diff, policy)`,
`validateValue(value, type, ast)`, `validateResponseBody(ast, path, method, status, body)`

**Standalone utilities** (for advanced use)

`createDeduplicator()`, `computeDedupeKey(input)`, `createCache(config)`,
`computeCacheKey(input)`, `isFresh(entry, now)`, `createQueue(config)`,
`createCancellationManager(config)`, `isAbortError(err)`, `linkSignals(...signals)`,
`withRetry(fn, opts, deps?)`, `computeBackoff(...)`, `parseRetryAfter(headers)`

### `@developerEhsan/api-client/codegen` (Node only)

`generate(options)`, `validate(input)`, `diff(input, output)`,
`parseOpenApi(doc)`, `emitTypes(ast, opts?)`, `emitModules(ast, opts?)`

### `@developerEhsan/api-client/testing`

`createMockClient(options)`, `createMockAdapter()`

### `@developerEhsan/api-client-query/{react,vue,solid}`

`createQueryIntegration(client, { modules, getNextPageParam?, pageParamName? })`,
`moduleKey(module)`, `methodKey(module, method, params?)`

---

## 26. Troubleshooting & FAQ

**`api.myModule.myMethod is not a function`**
You called a method you did not declare in `defineModule`. The runtime methods
are the ones you declare — codegen produces types/descriptors, not runtime
methods. Add the method (usually a thin `ctx.request(...)` wrapper).

**My `fetch` request never times out.**
It does now — timeouts are enforced by the client regardless of adapter. Make
sure you set `http.timeout` (default 10s).

**Two different users got the same cached/deduped response.**
This cannot happen: cache and dedup keys include an auth fingerprint and tenant
id. If you see stale data, check your `getToken`/`getTenantId` actually return
per-user values.

**OAuth2 keeps refreshing in a loop.**
A second 401 after a refresh is not re-refreshed — it surfaces as `AuthError`.
If refresh keeps failing, verify `refreshEndpoint` and that
`onTokensRefreshed` actually persists the new token your `getAccessToken` reads.

**Edge deploy fails trying to load `axios`.**
It shouldn't — the edge build uses `fetch` and never statically imports Axios.
Force `http.adapter: 'fetch'` if a bundler misdetects the runtime.

**Response validation throws in production.**
Set `openapi.validation.mode: 'loose'` (warn instead of throw), or disable it
outside development.

**Cancelling a request still resolves with data.**
Aborts reject with an `AbortError` and are never converted to cache hits, even
with `network-first` or `safeMode`. Ensure you pass the `signal` via per-call
config.

---

### Development (contributing to the library itself)

```bash
pnpm install
pnpm -r build       # build all packages
pnpm -r typecheck   # strict tsc
pnpm -r test        # vitest
```

Monorepo layout: `packages/core` (runtime), `packages/cli` (codegen),
`packages/tanstack-query` (framework integrations).
