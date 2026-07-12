import { ApiError, type ApiErrorInit } from './ApiError'

/** Token fetch or refresh failure, or an unrecoverable 401. Never retried. */
export class AuthError extends ApiError {
  override readonly name = 'AuthError'

  override get isRetryable(): boolean {
    return false
  }
}

export type { ApiErrorInit }
