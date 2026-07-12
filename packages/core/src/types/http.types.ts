/**
 * HTTP envelope types shared across adapters, pipeline, and error layers.
 */

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'

export type ResponseType = 'json' | 'blob' | 'text' | 'arraybuffer'

/**
 * A fully-resolved request as it enters the HTTP adapter. Produced by the
 * pipeline after config resolution, URL construction, and header merging.
 */
export interface ApiRequest {
  /** Absolute URL (baseURL + path + serialized query). */
  url: string
  method: HttpMethod
  headers: Record<string, string>
  /** Serialized request body (already JSON-stringified where relevant). */
  body?: unknown
  /** Raw query params, retained for cache-key/dedup-key computation. */
  query?: Record<string, unknown>
  /** Raw path params, retained for diagnostics. */
  pathParams?: Record<string, string | number>
  responseType?: ResponseType
  timeout?: number
  signal?: AbortSignal
  /** Module the request originated from, for diagnostics & cache keys. */
  moduleName?: string
  /** Method name within the module, for diagnostics & query keys. */
  methodName?: string
  /** Resolved tenant id for this request, if any. */
  tenantId?: string
  /** Arbitrary metadata carried through the pipeline. */
  meta?: Record<string, unknown>
}

/**
 * The typed response envelope returned to callers on success.
 */
export interface ApiResponse<T> {
  data: T
  status: number
  statusText?: string
  headers: Record<string, string>
  /** True when the response was served from cache. */
  fromCache?: boolean
}

/**
 * The raw result an {@link HttpAdapter} returns before response processing.
 */
export interface AdapterResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  /** Raw body — parsed JSON, Blob, string, or ArrayBuffer per responseType. */
  data: unknown
}

/**
 * Structured server error body, when the server returns `{ code, message, ... }`.
 */
export interface ServerErrorBody {
  code?: string
  message?: string
  details?: unknown
  [key: string]: unknown
}
