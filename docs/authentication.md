# Authentication

[← Docs index](./README.md)

Set `auth` globally, per module, or per call. Four strategies plus "none".

## Bearer token

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
- If it returns `null`: `warn` sends unauthenticated, `skip` sends without the
  header silently, `throw` raises an `AuthError`.
- If it throws, the request is not sent and an `AuthError` is raised.

**See it live:** the React example uses bearer auth with a tiny in-memory token
store. `api.auth.login(...)` writes the token; subsequent calls read it via
`getToken`. `onMissingToken: 'skip'` keeps public endpoints anonymous when logged
out — [`examples/react-vite/src/lib/api/api.config.ts`](../examples/react-vite/src/lib/api/api.config.ts).

## Cookie (browser session)

```ts
auth: { strategy: 'cookie' }   // sends credentials: 'include' automatically
```

Make sure your server sends `Access-Control-Allow-Credentials: true`.

## API key (header or query)

```ts
auth: {
  strategy: 'apiKey',
  getKey: () => process.env.API_KEY!,
  placement: 'header',   // or 'query'
  name: 'X-API-Key',     // header name or query-param name
}
```

## OAuth2 with automatic refresh

Handles the full **401 → refresh → retry-once** flow, and coalesces concurrent
401s so only **one** refresh runs at a time:

```ts
auth: {
  strategy: 'oauth2',
  getAccessToken:  () => tokenStore.access,
  getRefreshToken: () => tokenStore.refresh,
  refreshEndpoint: 'https://api.example.com/oauth/token',
  refreshPayload: (refreshToken) => ({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  onTokensRefreshed: (tokens) => {
    tokenStore.access = tokens.accessToken
    if (tokens.refreshToken) tokenStore.refresh = tokens.refreshToken
  },
  onRefreshFailed: (error) => { redirectToLogin() },
  concurrentRefreshStrategy: 'queue',  // 'queue' (default) or 'race'
}
```

The refresh response is expected to contain `access_token`/`accessToken` (and
optionally `refresh_token`/`refreshToken`). A second 401 after refreshing is
**not** re-refreshed (prevents infinite loops).

## Per-call: skip auth

```ts
await api.public.getStatus(undefined, { skipAuth: true })
```

## Server-side auth (Next.js RSC)

Never read `localStorage` on the server. Use the provided helper:

```ts
import { serverTokenFromCookie } from '@developerehsan/api-client'

auth: { strategy: 'bearer', getToken: serverTokenFromCookie('access_token') }
```

## Auth & cache/dedup safety

Cache and dedup keys include an **auth fingerprint**, so two users with different
tokens never share a cached or deduped response. See [caching](./caching.md) and
[deduplication](./deduplication.md).
</content>
