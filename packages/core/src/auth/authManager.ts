import type { ApiError } from '../errors/ApiError';
import type { ClassifierInput } from '../errors/errorClassifier';
import type { HttpAdapter } from '../http/adapters/adapterInterface';
import { applyAuth } from '../http/interceptors/auth.interceptor';
import {
  type TokenRefresher,
  createTokenRefresher,
} from '../http/interceptors/tokenRefresh.interceptor';
/**
 * Auth manager — the single entry point the pipeline uses for authentication.
 * Combines request-time injection ({@link applyAuth}) with the 401-driven
 * refresh flow ({@link createTokenRefresher}), holding the shared refresh mutex.
 */
import type { AuthConfig, AuthContribution } from '../types/auth.types';

/** Dependencies {@link createAuthManager} needs to build an {@link AuthManager}. */
export interface AuthManagerDeps {
  adapter: HttpAdapter;
  classifyError: (input: ClassifierInput) => ApiError;
}

/**
 * The pipeline's single entry point for authentication: resolving per-request
 * auth material and handling 401-driven token refresh.
 */
export interface AuthManager {
  /** Resolve the auth contribution for an outgoing request (step 8). */
  resolve(auth: AuthConfig, skip: boolean): Promise<AuthContribution>;
  /**
   * Handle a 401. Returns `true` when a refresh succeeded and the caller should
   * retry the request once; `false` otherwise. Only OAuth2 can refresh — every
   * other strategy returns `false`, so the 401 surfaces as an AuthError.
   */
  handleUnauthorized(auth: AuthConfig): Promise<boolean>;
}

/**
 * Build an {@link AuthManager} — combines request-time auth injection with the
 * shared-mutex OAuth2 refresh flow. Used internally by `createClient`; only
 * needed directly when composing the pipeline yourself.
 *
 * @example
 * import { createAuthManager } from '@developerehsan/api-client'
 * import { createFetchAdapter } from '@developerehsan/api-client'
 *
 * const authManager = createAuthManager({
 *   adapter: createFetchAdapter(),
 *   classifyError: (input) => new Error(input.message) as never,
 * });
 * const contribution = await authManager.resolve(
 *   { strategy: 'bearer', getToken: () => 'abc' },
 *   false,
 * );
 *
 * @see {@link https://github.com/developerEhsan/api-client/blob/master/docs/authentication.md}
 */
export function createAuthManager(deps: AuthManagerDeps): AuthManager {
  const refresher: TokenRefresher = createTokenRefresher(deps);

  return {
    resolve: (auth, skip) => applyAuth(auth, skip),
    handleUnauthorized: (auth) =>
      auth.strategy === 'oauth2' ? refresher.refresh(auth) : Promise.resolve(false),
  };
}
