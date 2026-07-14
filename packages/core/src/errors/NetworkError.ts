import { ApiError, type ApiErrorInit } from './ApiError';

export interface NetworkErrorInit extends ApiErrorInit {
  corsBlocked?: boolean;
  partial?: boolean;
  offline?: boolean;
}

/**
 * No HTTP response received: offline, DNS failure, CORS block, or interrupted stream.
 *
 * @example
 * ```ts
 * import { NetworkError } from '@developerEhsan/api-client'
 *
 * try {
 *   await api.pet.getPetById({ petId: 1 })
 * } catch (e) {
 *   if (e instanceof NetworkError) {
 *     if (e.offline) showOfflineBanner()
 *     else if (e.corsBlocked) console.error('CORS blocked')
 *   }
 * }
 * ```
 */
export class NetworkError extends ApiError {
  override readonly name = 'NetworkError';
  readonly corsBlocked: boolean;
  readonly partial: boolean;
  readonly offline: boolean;

  constructor(init: NetworkErrorInit) {
    super(init);
    this.corsBlocked = init.corsBlocked ?? false;
    this.partial = init.partial ?? false;
    this.offline = init.offline ?? false;
  }

  override get isRetryable(): boolean {
    return true;
  }
}
