import { ApiError, type ApiErrorInit } from './ApiError';

/**
 * Token fetch or refresh failure, or an unrecoverable 401. Never retried.
 *
 * @example
 * ```ts
 * import { AuthError } from '@developerEhsan/api-client'
 *
 * try {
 *   await api.pet.getPetById({ petId: 1 })
 * } catch (e) {
 *   if (e instanceof AuthError) redirectToLogin()
 * }
 * ```
 */
export class AuthError extends ApiError {
  override readonly name = 'AuthError';

  override get isRetryable(): boolean {
    return false;
  }
}

export type { ApiErrorInit };
