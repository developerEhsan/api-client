# Responses & error handling

[← Docs index](./README.md)

## The response envelope

Internally `ctx.request` resolves to an **`ApiResponse<T>`**:

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

## Typed error classes

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
import { ApiError, AuthError, TimeoutError } from '@developerehsan/api-client'

try {
  await api.users.get('42')
} catch (err) {
  if (err instanceof AuthError) redirectToLogin()
  else if (err instanceof TimeoutError) toast('Timed out, retry?')
  else if (err instanceof ApiError) console.error(err.status, err.serverError)
}
```

**See it live:** the Feature Lab "Typed error (404)" button catches an `ApiError`
and reads `status`/`code`; the "Timeout" and "Cancellation" buttons catch
`TimeoutError` and `AbortError` respectively —
[`FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx). The
direct-client demo surfaces `ApiError.status` + `message` in its UI —
[`DirectClientDemo.tsx`](../examples/react-vite/src/features/DirectClientDemo.tsx).

## Structured vs. unstructured server errors

- `{ code, message, details }` bodies are parsed into `error.serverError`.
- Non-JSON bodies (e.g. an HTML 5xx page) are kept in `error.rawBody`; the
  `error.message` is a short, truncated hint (never the whole document).

## Error hooks

```ts
createClient({ hooks: { onError: (error) => reportToSentry(error) } })
```

Or subscribe imperatively: `api.on('error', (err) => {})`. See
[hooks & events](./hooks-and-events.md).

## `safeMode` (no-throw)

Return a discriminated union instead of throwing:

```ts
createClient({ safeMode: true })

const result = await api.users.get('42')
if (result.success) use(result.data)
else handle(result.error)   // result.error is an ApiError
```

`AbortError`s still throw even in `safeMode`, so cancellation stays observable.

**See it live:** the Feature Lab creates a second client with `safeMode: true`
and shows the `{ success, error }` result — see the `safeApi` client in
[`FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx).
</content>
