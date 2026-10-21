---
'@developerehsan/api-client': major
---

v2: safer defaults and first-class file transfer, from production consumer reports (#37–#46).

**Breaking**

- **Response cache is off by default** (#40). `cache.enabled` was `true` with a 60s `cache-first` TTL, which served stale reads under an app's own query layer after a write. Pass `cache: { enabled: true }` to keep it.
- **Unsafe methods are no longer retried** (#42). Only `GET`/`HEAD`/`OPTIONS`/`TRACE`/`PUT`/`DELETE` retry by default — a failed `POST` may have already committed server-side. Opt back in with `retry: { retryUnsafeMethods: true }`.
- **Next.js server-context helpers moved to `@developerehsan/api-client/next`** (#41). The root entry no longer references `next/headers`, which was breaking Vite `optimizeDeps` in projects without Next.js installed.

**Added**

- `http.idempotency` — one auto-generated `Idempotency-Key` per logical call, replayed across its retries, making a retried write collapsible server-side (#42).
- `errorEnvelope` — teach the classifier a nested error shape so `error.message` is the server's message rather than a stringified payload (#39).
- `paginate` / `paginateItems` / `collectPages` — drive a cursor to exhaustion as an `AsyncIterable`, with same-cursor and `maxPages` guards (#43).
- `createIndexedDbStore({ crossTab: true })` — cross-tab cache invalidation over `BroadcastChannel`, matching the Redis store's `crossInstance` (#46).
- `FormData` bodies over the direct client and the RPC bridge, via `createRpcRouteHandler({ multipart: true })` (#38).
- Binary/file responses through the RPC bridge, via a server-declared `binary` allowlist on `createRpcHandler` (#37). Client-supplied `responseType` still cannot force it.
- `openapi` is now optional on `GlobalConfig` (#45).

**Fixed**

- A configured `Content-Type: application/json` no longer corrupts a `FormData` body by suppressing the multipart boundary (#38).
- Removed a stale "stubbed with TODOs" note from `createClient`'s shipped JSDoc that contradicted the README (#44).
