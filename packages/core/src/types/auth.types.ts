/**
 * Authentication strategy configuration types.
 */

import type { ApiError } from '../errors/ApiError';

export type AuthStrategyName = 'bearer' | 'cookie' | 'apiKey' | 'oauth2' | 'none';

/**
 * Bearer-token authentication. The resolved token is placed in a request
 * header (by default `Authorization: Bearer <token>`). Applies when
 * `strategy` is `'bearer'`.
 *
 * @example
 * ```ts
 * auth: {
 *   strategy: 'bearer',
 *   getToken: () => localStorage.getItem('token'),
 *   onMissingToken: 'warn', // skip the header but warn when no token is present
 * }
 * ```
 */
export interface BearerAuthConfig {
  /**
   * Discriminant selecting this strategy.
   * @default no default — required
   */
  strategy: 'bearer';
  /**
   * Returns the current token (or `null` when none is available). May be sync
   * or async; called before every authenticated request.
   * @default no default — required
   * @example
   * ```ts
   * // Async token retrieval, e.g. from a secure store.
   * getToken: async () => (await tokenStore.read())?.accessToken ?? null
   * ```
   */
  getToken: () => string | null | Promise<string | null>;
  /**
   * Header the token is written to.
   * @default 'Authorization' (documented convention)
   */
  headerName?: string;
  /**
   * Scheme prefix prepended to the token, joined by a space (e.g. `Bearer abc`).
   * Set to an empty string to send the raw token.
   * @default 'Bearer' (documented convention)
   */
  prefix?: string;
  /**
   * Behavior when `getToken` yields `null`/empty:
   * - `'throw'` — raise an `AuthError` and abort the request.
   * - `'skip'` — send the request with no auth header.
   * - `'warn'` — skip the header but emit a `console.warn`.
   * @default 'skip' (documented convention)
   */
  onMissingToken?: 'throw' | 'skip' | 'warn';
}

/**
 * Cookie-based authentication. Carries no fields; it simply instructs the
 * client to send credentials with the request (sets fetch
 * `credentials: 'include'`). Applies when `strategy` is `'cookie'`.
 *
 * @example
 * ```ts
 * // Session cookie set by the server; the client just forwards credentials.
 * auth: { strategy: 'cookie' }
 * ```
 */
export interface CookieAuthConfig {
  /**
   * Discriminant selecting this strategy.
   * @default no default — required
   */
  strategy: 'cookie';
}

/**
 * API-key authentication. The resolved key is attached either as a request
 * header or a query parameter. Applies when `strategy` is `'apiKey'`.
 *
 * @example
 * ```ts
 * // Petstore sends the key in the `api_key` header.
 * auth: {
 *   strategy: 'apiKey',
 *   getKey: () => process.env.PETSTORE_API_KEY!,
 *   placement: 'header',
 *   name: 'api_key',
 * }
 * ```
 */
export interface ApiKeyAuthConfig {
  /**
   * Discriminant selecting this strategy.
   * @default no default — required
   */
  strategy: 'apiKey';
  /**
   * Returns the API key. May be sync or async; called before every request.
   * @default no default — required
   */
  getKey: () => string | Promise<string>;
  /**
   * Where the key is placed:
   * - `'header'` — sent as the request header named by `name`.
   * - `'query'` — appended as the URL query parameter named by `name`.
   * @default no default — required
   */
  placement: 'header' | 'query';
  /**
   * Name of the header or query parameter the key is written under.
   * @default no default — required
   */
  name: string;
}

/**
 * Access/refresh token pair passed to `onTokensRefreshed` after a successful
 * OAuth2 refresh so the consumer can persist them.
 */
export interface OAuth2Tokens {
  /**
   * Newly issued access token.
   * @default no default — required
   */
  accessToken: string;
  /**
   * Newly issued refresh token, when the server rotates it.
   * @default optional, unset means the previous refresh token is retained
   */
  refreshToken?: string;
}

/**
 * OAuth2 authentication with automatic refresh-on-401. On a `401` the client
 * calls `refreshEndpoint` once, retries the original request, and reports the
 * outcome via the callbacks below. Applies when `strategy` is `'oauth2'`.
 *
 * @example
 * ```ts
 * auth: {
 *   strategy: 'oauth2',
 *   getAccessToken: () => tokenStore.access,
 *   getRefreshToken: () => tokenStore.refresh,
 *   refreshEndpoint: 'https://petstore3.swagger.io/api/v3/oauth/token',
 *   onTokensRefreshed: (tokens) => tokenStore.save(tokens),
 *   onRefreshFailed: () => redirectToLogin(),
 * }
 * ```
 */
export interface OAuth2AuthConfig {
  /**
   * Discriminant selecting this strategy.
   * @default no default — required
   */
  strategy: 'oauth2';
  /**
   * Returns the current access token (or `null`). Sync or async.
   * @default no default — required
   */
  getAccessToken: () => string | null | Promise<string | null>;
  /**
   * Returns the current refresh token (or `null`), used to build the refresh
   * request. Sync or async.
   * @default no default — required
   */
  getRefreshToken: () => string | null | Promise<string | null>;
  /**
   * URL called (POST) when a `401` triggers a token refresh.
   * @default no default — required
   */
  refreshEndpoint: string;
  /**
   * Builds the request body sent to `refreshEndpoint` from the current refresh
   * token. When unset, a default payload shape is used.
   * @default optional, unset means the client's default refresh body is sent
   */
  refreshPayload?: (refreshToken: string) => Record<string, unknown>;
  /**
   * Called with the freshly issued tokens so they can be persisted. Sync or
   * async.
   * @default no default — required
   */
  onTokensRefreshed: (tokens: OAuth2Tokens) => void | Promise<void>;
  /**
   * Called when the refresh attempt itself fails (e.g. refresh token expired),
   * letting the app log out or redirect. Sync or async.
   * @default no default — required
   */
  onRefreshFailed: (error: ApiError) => void | Promise<void>;
  /**
   * How simultaneous `401`s coordinate their refresh:
   * - `'queue'` — concurrent 401s wait for a single shared refresh.
   * - `'race'` — each 401 refreshes independently.
   * @default 'queue'
   */
  concurrentRefreshStrategy?: 'queue' | 'race';
}

/**
 * Disables authentication entirely. Applies when `strategy` is `'none'`; this
 * is the effective default when no `auth` block is configured.
 */
export interface NoAuthConfig {
  /**
   * Discriminant selecting this strategy.
   * @default no default — required
   */
  strategy: 'none';
}

/**
 * Discriminated union (on `strategy`) of every supported authentication
 * strategy. The configured member determines what auth material each request
 * carries.
 */
export type AuthConfig =
  | BearerAuthConfig
  | CookieAuthConfig
  | ApiKeyAuthConfig
  | OAuth2AuthConfig
  | NoAuthConfig;

/**
 * What an auth strategy contributes to an outgoing request: header/query
 * additions and whether cookie credentials must be included. Strategy helpers
 * return a `Partial`; the interceptor folds them into a full contribution.
 */
export interface AuthContribution {
  /** Headers to merge into the outgoing request. */
  headers: Record<string, string>;
  /** Query parameters to merge into the outgoing request URL. */
  query: Record<string, unknown>;
  /** When `true`, send cookie credentials (fetch `credentials: 'include'`). */
  cookie: boolean;
}
