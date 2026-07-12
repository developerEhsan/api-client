/**
 * Authentication strategy configuration types.
 */

import type { ApiError } from '../errors/ApiError'

export type AuthStrategyName = 'bearer' | 'cookie' | 'apiKey' | 'oauth2' | 'none'

export interface BearerAuthConfig {
  strategy: 'bearer'
  getToken: () => string | null | Promise<string | null>
  headerName?: string
  prefix?: string
  onMissingToken?: 'throw' | 'skip' | 'warn'
}

export interface CookieAuthConfig {
  strategy: 'cookie'
}

export interface ApiKeyAuthConfig {
  strategy: 'apiKey'
  getKey: () => string | Promise<string>
  placement: 'header' | 'query'
  name: string
}

export interface OAuth2Tokens {
  accessToken: string
  refreshToken?: string
}

export interface OAuth2AuthConfig {
  strategy: 'oauth2'
  getAccessToken: () => string | null | Promise<string | null>
  getRefreshToken: () => string | null | Promise<string | null>
  refreshEndpoint: string
  refreshPayload?: (refreshToken: string) => Record<string, unknown>
  onTokensRefreshed: (tokens: OAuth2Tokens) => void | Promise<void>
  onRefreshFailed: (error: ApiError) => void | Promise<void>
  concurrentRefreshStrategy?: 'queue' | 'race'
}

export interface NoAuthConfig {
  strategy: 'none'
}

export type AuthConfig =
  | BearerAuthConfig
  | CookieAuthConfig
  | ApiKeyAuthConfig
  | OAuth2AuthConfig
  | NoAuthConfig

/**
 * What an auth strategy contributes to an outgoing request: header/query
 * additions and whether cookie credentials must be included. Strategy helpers
 * return a `Partial`; the interceptor folds them into a full contribution.
 */
export interface AuthContribution {
  headers: Record<string, string>
  query: Record<string, unknown>
  cookie: boolean
}
