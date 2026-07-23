# Mental model

[← Docs index](./README.md)

There are exactly **three concepts** to understand.

**1. The client** — created once with `createClient(config)` (or
`createTypedClient`). It holds your global settings and the shared state (cache,
dedup map, queue, event emitter).

**2. Modules & methods** — you group endpoints into *modules* (e.g. `invoices`,
`users`) and declare *methods* on them with `defineModule`. Each method uses the
`ctx.request(...)` primitive to perform an HTTP call. Method names and paths are
yours to choose. See [modules & methods](./modules-and-methods.md).

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

The single network dispatch point is the **adapter** (`fetch` or `axios`, chosen
automatically per environment). Each stage is a documented feature:

| Stage | Doc |
| --- | --- |
| Config resolution | [configuration](./configuration.md) |
| Concurrency queue | [concurrency-queue](./concurrency-queue.md) |
| Deduplication | [deduplication](./deduplication.md) |
| Cache | [caching](./caching.md) |
| Tenant | [multi-tenancy](./multi-tenancy.md) |
| Auth | [authentication](./authentication.md) |
| Timeout | [timeouts-and-cancellation](./timeouts-and-cancellation.md) |
| Retry | [retries](./retries.md) |
| Validation | [schema-validation](./schema-validation.md) |

## Codegen vs. runtime

The CLI generates **types** and a **module descriptor map** from your OpenAPI
spec. Those give you compile-time safety and feed the TanStack integration. The
actual runtime *methods* you call are the ones you declare with `defineModule` —
usually thin wrappers over `ctx.request(...)` that reference the generated paths.
This keeps runtime behavior explicit and debuggable. See [codegen](./codegen.md).

## See the pipeline live

The **Feature Lab** tab in the React example fires one pipeline feature per
button and mirrors the client's real events into a live log, so you can watch
each stage work:
[`examples/react-vite/src/features/FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx).
</content>
