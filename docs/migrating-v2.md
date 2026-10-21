# Migrating to v2

v2 is a small release with a sharp edge: three defaults changed, and all three
changed because the old default was the unsafe one. Everything else is additive.

Every change below came from [issues #37–#46](https://github.com/developerEhsan/api-client/issues),
reported by a production consumer.

## Breaking changes

### 1. The response cache is off by default (#40)

**Before:** `cache.enabled` defaulted to `true` with a 60s `cache-first` TTL.
**Now:** it defaults to `false`.

A write would commit, your query layer would refetch, and the client's own
cache would still serve the 60s-old response underneath it — a stale read with
nothing in the UI to explain it. Apps pairing this client with TanStack Query
or SWR were silently double-cached.

```diff
  createClient({
    baseURL,
+   cache: { enabled: true },          // only if you actually want the L1 cache
    cache: { ttl: 60_000, strategy: 'cache-first' },
  })
```

Nothing to do if you were already passing `cache: { enabled: false }`, or if
you never wanted the cache.

### 2. Unsafe HTTP methods are no longer retried (#42)

**Before:** all 5xx/429/network failures retried, on any method.
**Now:** only `GET`, `HEAD`, `OPTIONS`, `TRACE`, `PUT` and `DELETE` retry.

A `POST` that fails with a 5xx or a dropped connection may have already
committed server-side. Retrying it creates the resource twice.

To keep the old behavior on a write, opt in — and send an idempotency key so
the duplicate is collapsed rather than committed:

```ts
createClient({
  baseURL,
  http: {
    retry: { attempts: 3, retryUnsafeMethods: true },
    idempotency: { enabled: true }, // Idempotency-Key on POST + PATCH
  },
})
```

One key is generated per logical call and replayed across every retry of that
call. Your API has to honor the header for it to mean anything — the client
only guarantees the key is stable.

A custom `retryOn` predicate still overrides this entirely; it is you stating
the policy yourself.

### 3. Next.js helpers moved to `/next` (#41)

`readServerHeader`, `readServerCookie`, `serverTenantResolver` and
`serverTokenFromCookie` are no longer exported from the root entry.

```diff
- import { serverTokenFromCookie } from '@developerehsan/api-client'
+ import { serverTokenFromCookie } from '@developerehsan/api-client/next'
```

They reach for `next/headers`, and having them on the root entry meant every
consumer's bundler tried to resolve `next` — which broke Vite dev servers in
projects with no Next.js installed. The root entry now contains no reference to
`next` at all, so the `optimizeDeps.exclude` workaround is no longer needed.

## New

### `openapi` is optional (#45)

```diff
- createClient({ baseURL, openapi: {} })
+ createClient({ baseURL })
```

Every field inside it was already optional; requiring the block bought no type
safety.

### Custom error envelopes (#39)

The classifier only recognized a flat `{ code, message }`. A nested envelope
fell through to `rawBody`, so `error.message` came out as a stringified JSON
blob — in practice, raw JSON rendered into user-facing toasts.

```ts
createClient({
  baseURL,
  // API returns { error: { code, message, details } }
  errorEnvelope: (body) => (body as { error?: ServerErrorBody }).error ?? null,
})
```

Return `null` to fall back to the built-in detection. A parser that throws is
caught — it can never mask the original failure.

### Cursor pagination (#43)

```ts
import { paginate, paginateItems, collectPages } from '@developerehsan/api-client'

for await (const flag of paginateItems(
  (cursor) => api.flags.list({ query: { cursor, limit: 100 } }),
  { nextCursor: (p) => p.nextCursor, items: (p) => p.data },
)) { /* ... */ }
```

`paginate` yields pages, `paginateItems` yields items, `collectPages` drains
into an array. A server that echoes the same cursor back terminates the loop
rather than spinning, and `maxPages` (default 10,000) backstops the rest.

### Cross-tab cache invalidation for IndexedDB (#46)

The browser-side L2 store now has the same cross-instance coherency the Redis
store got, over `BroadcastChannel`:

```ts
createIndexedDbStore({ crossTab: true })
```

A mutation in one tab now invalidates the cached GET in every other open tab.
No-ops where `BroadcastChannel` is unavailable.

### `FormData` bodies (#38)

Multipart bodies now work on both paths.

**Direct client** — a `FormData` body is passed through untouched, and a
globally-configured `Content-Type: application/json` is dropped for it so the
runtime can generate the multipart boundary:

```ts
await api.files.upload(formData)
```

**RPC bridge** — `httpTransport` detects `File`/`Blob` arguments and switches
that call to a multipart body: the JSON envelope travels in an `__rpc` part
with `{ __rpcFile }` placeholders, the bytes as their own parts. Opt the route
in:

```ts
createRpcRouteHandler(handler, {
  multipart: true,
  maxUploadBytes: 10 * 1024 * 1024, // default 10 MB
})
```

Off by default: multipart widens the accepted content types, and such a body is
not covered by the JSON-content-type half of the CSRF defence — it leans
entirely on the Origin check. Keep `csrf: true` when enabling it.

### Binary responses through the RPC bridge (#37)

A module method can now return a file through the bridge. **The server
declares which methods are binary** — a client-supplied `responseType` is still
stripped by `sanitizePerCall` (S4), so the browser can never turn a JSON method
into a byte stream:

```ts
createRpcHandler(api, {
  expose: { exports: ['flagsCsv', 'logsCsv'] },
  binary: { exports: ['flagsCsv', 'logsCsv'] },   // must be in BOTH
  binaryFilename: (call) => `${call.method}-${Date.now()}.csv`,
})
```

The route streams the result back with its own `Content-Type` and
`Content-Disposition` instead of wrapping it in the JSON envelope, and
`httpTransport` surfaces it to the caller as a `Blob`. Filenames are sanitized
against header injection. A binary method inside a *batch* is refused — a batch
is one JSON array, with nowhere for a byte stream to go.
