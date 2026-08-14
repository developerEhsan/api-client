# 05 — Refresh-token DX: callback alternative + pluggable token storage

## Problem

`OAuth2AuthConfig` (`packages/core/src/types/auth.types.ts:154-201`) only
supports **endpoint-based** refresh: `refreshEndpoint: string`, a required
URL the client POSTs to on a 401. Some real setups don't have a plain HTTP
refresh endpoint to point at — refresh logic might live behind a BFF call,
an SDK method (e.g. a third-party auth provider's own refresh function), or
custom signing logic. Today those developers are forced to stand up a fake
internal endpoint just to satisfy the shape, or fork the flow entirely.

Separately, token *persistence* (`onTokensRefreshed`) is a single callback
with no structure — every developer reinvents "where do I put this" (cookie?
localStorage? server session?) with no guidance or pluggable adapter, unlike
the cache layer which already has a clean adapter pattern
(`PersistentCacheStore`).

## Current state (reference)

- `OAuth2AuthConfig` — `auth.types.ts:154-201`: `getAccessToken`,
  `getRefreshToken`, `refreshEndpoint` (required), `refreshPayload?`,
  `onTokensRefreshed`, `onRefreshFailed`, `concurrentRefreshStrategy`.
- `OAuth2Tokens` — `auth.types.ts` around line 125-135 (`accessToken`,
  `refreshToken?`).
- Refresh execution — `packages/core/src/http/interceptors/tokenRefresh.interceptor.ts`:
  `performRefresh()` builds a POST request to `config.refreshEndpoint`
  unconditionally (there is no branch for a non-HTTP refresh path), mutex via
  `inflightByConfig: WeakMap<OAuth2AuthConfig, Promise<boolean>>` keyed by
  config identity, respecting `concurrentRefreshStrategy`.

## Design

### 1. Make the refresh mechanism a discriminated union: endpoint or callback

```ts
// auth.types.ts
export interface OAuth2AuthConfig {
  strategy: 'oauth2';
  getAccessToken: () => string | null | Promise<string | null>;
  getRefreshToken: () => string | null | Promise<string | null>;

  /**
   * HTTP refresh: POSTs to this URL with `refreshPayload(refreshToken)`
   * (or the default `{ refresh_token }` shape) and expects a JSON body
   * matching `OAuth2Tokens`.
   * Exactly one of `refreshEndpoint` or `refresh` must be set.
   */
  refreshEndpoint?: string;
  refreshPayload?: (refreshToken: string) => Record<string, unknown>;

  /**
   * Callback refresh: bypasses HTTP entirely. Return the new tokens (or
   * throw/reject to signal failure — caught the same way an HTTP refresh
   * failure is). Use this when refresh logic lives in an SDK call, a BFF
   * function, or anywhere that isn't "just POST a URL".
   * Exactly one of `refreshEndpoint` or `refresh` must be set.
   */
  refresh?: (currentRefreshToken: string) => Promise<OAuth2Tokens>;

  onTokensRefreshed: (tokens: OAuth2Tokens) => void | Promise<void>;
  onRefreshFailed: (error: ApiError) => void | Promise<void>;
  concurrentRefreshStrategy?: 'queue' | 'race';
}
```

Enforce "exactly one of `refreshEndpoint`/`refresh`" at the type level with a
discriminated union rather than two optional fields, to catch the
misconfiguration at compile time instead of runtime:

```ts
type OAuth2RefreshMechanism =
  | { refreshEndpoint: string; refreshPayload?: (rt: string) => Record<string, unknown>; refresh?: never }
  | { refresh: (rt: string) => Promise<OAuth2Tokens>; refreshEndpoint?: never; refreshPayload?: never };

export type OAuth2AuthConfig = Omit<OAuth2AuthConfigBase, 'refreshEndpoint' | 'refreshPayload' | 'refresh'> &
  OAuth2RefreshMechanism;
```

(Exact mechanical split left to implementation — the requirement is a
compile-time either/or, not a runtime check standing in for it. A runtime
check should still exist as a defense-in-depth `ConfigurationError` throw at
client construction time — never silently pick one if both/neither are set.)

### 2. Update `performRefresh` to branch on which mechanism is present

```ts
// tokenRefresh.interceptor.ts
async function performRefresh(config: OAuth2AuthConfig): Promise<boolean> {
  let refreshToken: string | null;
  try {
    refreshToken = await config.getRefreshToken();
  } catch (cause) {
    await config.onRefreshFailed(refreshFailure('getRefreshToken() threw.', cause));
    return false;
  }
  if (!refreshToken) {
    await config.onRefreshFailed(refreshFailure('No refresh token available.'));
    return false;
  }

  try {
    const tokens = config.refresh
      ? await config.refresh(refreshToken)                 // NEW callback path
      : await performHttpRefresh(config, refreshToken);      // existing path, extracted unchanged
    await config.onTokensRefreshed(tokens);
    return true;
  } catch (cause) {
    await config.onRefreshFailed(classifyError({ cause /* ... */ }));
    return false;
  }
}
```

The existing mutex (`inflightByConfig` WeakMap keyed by config identity) and
`concurrentRefreshStrategy` behavior apply identically to both paths — no
change needed there, since both just resolve to "an async function that
returns tokens or throws."

### 3. Pluggable token storage adapter (mirrors `PersistentCacheStore`)

New, optional, separate from the auth config itself so it composes cleanly:

```ts
// types/auth.types.ts (or a new tokenStorage.types.ts)
export interface TokenStorage {
  getTokens(): OAuth2Tokens | null | Promise<OAuth2Tokens | null>;
  setTokens(tokens: OAuth2Tokens): void | Promise<void>;
  clearTokens(): void | Promise<void>;
}
```

When a developer supplies `tokenStorage` instead of hand-writing
`getAccessToken`/`getRefreshToken`/`onTokensRefreshed`, the client derives
those three from the adapter:

```ts
auth: {
  strategy: 'oauth2',
  tokenStorage: createCookieTokenStorage({ name: 'app_session' }), // or createLocalStorageTokenStorage(), or a custom object literal
  refreshEndpoint: '/auth/refresh', // or `refresh:` callback
  onRefreshFailed: () => redirectToLogin(),
}
```

`tokenStorage` and the manual `getAccessToken`/`getRefreshToken`/
`onTokensRefreshed` triplet are mutually exclusive at the type level (same
discriminated-union technique as above) — don't let both be set silently
with one winning arbitrarily.

Ship 1-2 reference adapters analogous to `createMemoryPersistentStore`/
`createIndexedDbStore` in `cache-stores/index.ts` — e.g.
`createMemoryTokenStorage()` (tests, SSR warm-up) and
`createLocalStorageTokenStorage()` (browser only, feature-detected the same
way `createIndexedDbStore` detects `indexedDB`). Do **not** ship a cookie
adapter that sets `httpOnly` cookies from client-side JS — that's
impossible by design (httpOnly cookies aren't readable/writable from JS) and
suggesting otherwise would be a security foot-gun; if a cookie-based adapter
is wanted, document that it must be paired with a server-side route that
sets the cookie, and the client-side adapter only reads/mirrors non-sensitive
state.

## Security constraints specific to this file

- **Never log or include tokens in any error/event payload.** `onRefreshFailed`
  receives an `ApiError` — audit that error construction path
  (`refreshFailure(...)`) never embeds the raw token value in its message.
- **The callback `refresh` function's return value must be validated** the
  same way an HTTP JSON response would need shape-checking — a malformed
  return (missing `accessToken`) must produce a `SchemaError`/`ConfigurationError`,
  not silently proceed with `undefined` as the new access token.
- **`TokenStorage` adapters must not become a second source of truth that
  drifts from the in-flight refresh mutex.** `setTokens` should be called
  exactly once per successful refresh, from the same place
  `onTokensRefreshed` fires today — don't add a second write path.
- Reference storage adapters that touch `localStorage`/cookies are
  browser-only concerns — feature-detect and gate exactly like
  `createIndexedDbStore`, and confirm via
  `scripts/check-browser-bundle.mjs` that none of this pulls Node-only APIs
  into the browser bundle (it shouldn't, but the callback `refresh` path
  means arbitrary user code can now run in more places — verify it doesn't
  change the bundle's own footprint, not the user's).

## Tests to add

`packages/core/src/http/interceptors/tokenRefresh.interceptor.test.ts` (extend):
- `refresh` callback path: success updates tokens via `onTokensRefreshed`,
  concurrent 401s under `'queue'` still coalesce onto one `refresh()` call
  (reuse existing mutex test pattern, just swap the mechanism).
- `refresh` callback throwing surfaces through `onRefreshFailed`, never
  bubbles as an unhandled rejection.
- Config with **both** `refreshEndpoint` and `refresh` set — if a runtime
  guard is implemented, assert it throws `ConfigurationError` at client
  construction, not at first-401 time (fail fast).
- Config with **neither** set — same assertion.

`packages/core/src/auth/tokenStorage.test.ts` (new):
- Reference adapters round-trip tokens correctly.
- `tokenStorage` + manual getters both set → construction-time
  `ConfigurationError`.

## Docs to update after shipping

`docs/authentication.md` — add the callback-refresh example and the
`TokenStorage` adapter section, explicitly including the httpOnly-cookie
caveat above so users don't attempt an insecure pattern.
