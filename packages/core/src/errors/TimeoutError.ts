import { ApiError, type ApiErrorInit } from './ApiError'

/** Request exceeded the configured timeout and was aborted. */
export class TimeoutError extends ApiError {
  override readonly name = 'TimeoutError'
  readonly timeoutMs?: number

  constructor(init: ApiErrorInit & { timeoutMs?: number }) {
    super(init)
    this.timeoutMs = init.timeoutMs
  }

  override get isRetryable(): boolean {
    return true
  }
}
