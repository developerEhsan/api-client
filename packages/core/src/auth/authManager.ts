/**
 * Auth manager — the single entry point the pipeline uses for authentication.
 * Combines request-time injection ({@link applyAuth}) with the 401-driven
 * refresh flow ({@link createTokenRefresher}), holding the shared refresh mutex.
 */
import type { AuthConfig, AuthContribution } from '../types/auth.types'
import type { HttpAdapter } from '../http/adapters/adapterInterface'
import type { ApiError } from '../errors/ApiError'
import type { ClassifierInput } from '../errors/errorClassifier'
import { applyAuth } from '../http/interceptors/auth.interceptor'
import {
  createTokenRefresher,
  type TokenRefresher,
} from '../http/interceptors/tokenRefresh.interceptor'

export interface AuthManagerDeps {
  adapter: HttpAdapter
  classifyError: (input: ClassifierInput) => ApiError
}

export interface AuthManager {
  /** Resolve the auth contribution for an outgoing request (step 8). */
  resolve(auth: AuthConfig, skip: boolean): Promise<AuthContribution>
  /**
   * Handle a 401. Returns `true` when a refresh succeeded and the caller should
   * retry the request once; `false` otherwise. Only OAuth2 can refresh — every
   * other strategy returns `false`, so the 401 surfaces as an AuthError.
   */
  handleUnauthorized(auth: AuthConfig): Promise<boolean>
}

export function createAuthManager(deps: AuthManagerDeps): AuthManager {
  const refresher: TokenRefresher = createTokenRefresher(deps)

  return {
    resolve: (auth, skip) => applyAuth(auth, skip),
    handleUnauthorized: (auth) =>
      auth.strategy === 'oauth2'
        ? refresher.refresh(auth)
        : Promise.resolve(false),
  }
}
