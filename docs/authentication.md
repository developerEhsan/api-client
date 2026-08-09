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

### Callback refresh (no HTTP endpoint)

Some setups don't have a plain refresh URL — the logic lives behind a BFF
call, a third-party SDK, or custom signing. Use `refresh` instead of
`refreshEndpoint`; everything else (the mutex, `concurrentRefreshStrategy`,
`onTokensRefreshed`/`onRefreshFailed`) works identically:

```ts
auth: {
  strategy: 'oauth2',
  getAccessToken:  () => tokenStore.access,
  getRefreshToken: () => tokenStore.refresh,
  refresh: async (refreshToken) => {
    const tokens = await thirdPartySdk.refresh(refreshToken) // returns { accessToken, refreshToken? }
    return tokens
  },
  onTokensRefreshed: (tokens) => { tokenStore.access = tokens.accessToken },
  onRefreshFailed: (error) => { redirectToLogin() },
}
```

Exactly one of `refreshEndpoint` or `refresh` must be set — the type enforces
this, and the client also throws a `ConfigurationError` at construction time
as defense-in-depth. A `refresh()` that throws/rejects is treated as a
refresh failure (`onRefreshFailed` fires); a resolved value with no
`accessToken` string is treated the same way — it's validated like an HTTP
response body would be, never silently proceeds with `undefined`.

### Pluggable token storage

Instead of hand-writing `getAccessToken`/`getRefreshToken`/
`onTokensRefreshed`, supply `tokenStorage` — an adapter mirroring
`PersistentCacheStore`'s pattern. The client derives all three from it:

```ts
import { createMemoryTokenStorage, createLocalStorageTokenStorage } from '@developerehsan/api-client'

auth: {
  strategy: 'oauth2',
  tokenStorage: createLocalStorageTokenStorage(), // or createMemoryTokenStorage() for tests/SSR warm-up
  refreshEndpoint: 'https://api.example.com/oauth/token', // or `refresh:`
  onRefreshFailed: (error) => { redirectToLogin() },
}
```

`tokenStorage` and the manual triplet are mutually exclusive — set exactly
one.

**`httpOnly` cookies:** `createLocalStorageTokenStorage` reads/writes
`localStorage`, which is readable by any script on the page (an XSS risk if
your threat model cares about that). It is **not** a way to work with
`httpOnly` cookies — those aren't readable/writable from JS by design. If
your backend sets an `httpOnly` session cookie, use `strategy: 'cookie'`
instead of `tokenStorage`; there is intentionally no cookie-backed
`TokenStorage` adapter, since one that could read/write an `httpOnly` cookie
from client JS would defeat the point of `httpOnly`.

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

## Logout: clearing the cache

On the same device, a stale cache entry scoped to a now-logged-out user can
otherwise linger until it naturally expires. Clear it wherever your app
already handles session end — `client.cache.clear()` clears every layer (the
in-memory L1, an optional persistent L2, and the tag index) in one call, so
there's no second, partial clear path to keep in sync:

```ts
auth: {
  strategy: 'oauth2',
  // ...
  onRefreshFailed: async (error) => {
    await api.cache.clear()
    redirectToLogin()
  },
}

// and/or a user-initiated "log out" button, which isn't preceded by a failed refresh:
async function logout() {
  await api.cache.clear()
  await tokenStorage.clearTokens() // if using a TokenStorage adapter
  redirectToLogin()
}
```
</content>
