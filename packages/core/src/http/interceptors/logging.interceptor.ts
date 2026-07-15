import type { ApiError } from '../../errors/ApiError';
/**
 * Dev-mode request/response/error logger. Produces a set of lifecycle hooks
 * that log through the pipeline; composed with (and running before) any
 * user-supplied hooks in `createClient`.
 */
import type { ApiRequest, ApiResponse } from '../../types/http.types';

export type LogLevel = boolean | 'verbose';

export interface LoggingHooks {
  onRequest(request: ApiRequest): ApiRequest;
  onResponse<T>(response: ApiResponse<T>): ApiResponse<T>;
  onError(error: ApiError): void;
}

const PREFIX = '[api-client]';

/**
 * Build logging hooks for the given level. `false` yields no-op hooks;
 * `'verbose'` additionally logs headers and bodies.
 */
export function createLoggingInterceptor(level: LogLevel): LoggingHooks {
  const enabled = level !== false;
  const verbose = level === 'verbose';

  return {
    onRequest(request) {
      if (enabled) {
        console.log(`${PREFIX} → ${request.method} ${request.url}`);
        if (verbose) {
          console.log(`${PREFIX}   headers`, request.headers);
          if (request.body !== undefined) console.log(`${PREFIX}   body`, request.body);
        }
      }
      return request;
    },
    onResponse(response) {
      if (enabled) {
        console.log(`${PREFIX} ← ${response.status} ${response.statusText ?? ''}`.trimEnd());
        if (verbose) console.log(`${PREFIX}   data`, response.data);
      }
      return response;
    },
    onError(error) {
      if (enabled) {
        console.error(
          `${PREFIX} ✖ ${error.name}${error.status ? ` (${error.status})` : ''}: ${error.message}`,
        );
      }
    },
  };
}
