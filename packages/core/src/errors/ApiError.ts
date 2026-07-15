import type { ApiRequest, ServerErrorBody } from '../types/http.types';

export interface ApiErrorInit {
  message: string;
  status?: number;
  /** Machine-readable code, from server body or classifier. */
  code?: string;
  request?: ApiRequest;
  /** Parsed structured server error body, when present. */
  serverError?: ServerErrorBody | null;
  /** Raw response body when it could not be parsed as structured JSON. */
  rawBody?: string;
  /** The underlying cause (network error, parse error, etc.). */
  cause?: unknown;
  /** Number of retry attempts made before this error was thrown. */
  retryCount?: number;
  /** Response headers, when a response was received (used for `Retry-After`). */
  responseHeaders?: Record<string, string>;
}

/**
 * Base typed error for all failed requests. Subclasses (`NetworkError`,
 * `TimeoutError`, `AuthError`, `SchemaError`, `ConfigurationError`) narrow the
 * failure category. Never throw a bare `Error` from the pipeline.
 *
 * @example
 * ```ts
 * import { ApiError } from '@developerehsan/api-client'
 *
 * try {
 *   await api.pet.getPetById({ petId: 1 })
 * } catch (e) {
 *   if (e instanceof ApiError) {
 *     console.error(e.status, e.code, e.serverError?.message)
 *     if (e.isRetryable) scheduleRetry()
 *   }
 * }
 * ```
 */
export class ApiError extends Error {
  override readonly name: string = 'ApiError';
  readonly status?: number;
  readonly code?: string;
  readonly request?: ApiRequest;
  readonly serverError: ServerErrorBody | null;
  readonly rawBody?: string;
  readonly retryCount: number;
  readonly responseHeaders?: Record<string, string>;

  constructor(init: ApiErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.status = init.status;
    this.code = init.code;
    this.request = init.request;
    this.serverError = init.serverError ?? null;
    this.rawBody = init.rawBody;
    this.retryCount = init.retryCount ?? 0;
    this.responseHeaders = init.responseHeaders;
    // Restore prototype chain for extending built-ins under transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** True for 5xx and network-level failures (retryable by default). */
  get isRetryable(): boolean {
    if (this.status === undefined) return true; // network / unknown
    if (this.status === 429) return true;
    return this.status >= 500;
  }
}
