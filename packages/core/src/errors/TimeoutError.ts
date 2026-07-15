import { ApiError, type ApiErrorInit } from './ApiError';

/**
 * Request exceeded the configured timeout and was aborted.
 *
 * @example
 * ```ts
 * import { TimeoutError } from '@developerehsan/api-client'
 *
 * try {
 *   await api.pet.getPetById({ petId: 1 }, { timeout: 2000 })
 * } catch (e) {
 *   if (e instanceof TimeoutError) console.warn(`Timed out after ${e.timeoutMs}ms`)
 * }
 * ```
 */
export class TimeoutError extends ApiError {
  override readonly name = 'TimeoutError';
  readonly timeoutMs?: number;

  constructor(init: ApiErrorInit & { timeoutMs?: number }) {
    super(init);
    this.timeoutMs = init.timeoutMs;
  }

  override get isRetryable(): boolean {
    return true;
  }
}
