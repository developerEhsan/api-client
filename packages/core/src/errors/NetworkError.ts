import { ApiError, type ApiErrorInit } from './ApiError'

export interface NetworkErrorInit extends ApiErrorInit {
  corsBlocked?: boolean
  partial?: boolean
  offline?: boolean
}

/** No HTTP response received: offline, DNS failure, CORS block, or interrupted stream. */
export class NetworkError extends ApiError {
  override readonly name = 'NetworkError'
  readonly corsBlocked: boolean
  readonly partial: boolean
  readonly offline: boolean

  constructor(init: NetworkErrorInit) {
    super(init)
    this.corsBlocked = init.corsBlocked ?? false
    this.partial = init.partial ?? false
    this.offline = init.offline ?? false
  }

  override get isRetryable(): boolean {
    return true
  }
}
