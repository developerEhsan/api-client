import { ApiError } from './ApiError'

/**
 * Thrown eagerly (at `createClient`/`defineModule` time, or synchronously
 * before a network call) for invalid configuration: bad environment key,
 * missing required config, unserializable body, failing tenant resolver.
 */
export class ConfigurationError extends ApiError {
  override readonly name = 'ConfigurationError'

  constructor(message: string, cause?: unknown) {
    super({ message, cause })
  }

  override get isRetryable(): boolean {
    return false
  }
}
