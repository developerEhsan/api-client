import type { ApiRequest, ServerErrorBody } from '../types/http.types'
import { ApiError } from './ApiError'
import { AuthError } from './AuthError'
import { NetworkError } from './NetworkError'
import { TimeoutError } from './TimeoutError'

/** An HTTP response was received but signals a failure status. */
export interface HttpFailure {
  kind: 'http'
  status: number
  statusText: string
  headers: Record<string, string>
  data: unknown
  request?: ApiRequest
}

/** No HTTP response was received (offline, DNS, CORS, interrupted stream). */
export interface NetworkFailure {
  kind: 'network'
  cause: unknown
  request?: ApiRequest
  corsBlocked?: boolean
  partial?: boolean
  offline?: boolean
}

/** The request exceeded its configured timeout and was aborted. */
export interface TimeoutFailure {
  kind: 'timeout'
  timeoutMs: number
  request?: ApiRequest
}

/** Discriminated description of a request failure, consumed by {@link classifyError}. */
export type ClassifierInput = HttpFailure | NetworkFailure | TimeoutFailure

/** Result of splitting a response body into a structured error vs. raw text. */
export interface ExtractedServerError {
  serverError: ServerErrorBody | null
  rawBody?: string
}

/**
 * Split a raw response body into a structured {@link ServerErrorBody} when it
 * matches the `{ code, message, details }` shape, or a `rawBody` string
 * otherwise. Never throws (N4/Er1/Er2).
 */
export function extractServerError(data: unknown): ExtractedServerError {
  if (data === undefined || data === null) return { serverError: null }

  if (isServerErrorBody(data)) {
    return { serverError: data }
  }

  if (typeof data === 'string') {
    return data.length > 0 ? { serverError: null, rawBody: data } : { serverError: null }
  }

  // Non-structured object/array/primitive: stringify best-effort as rawBody.
  return { serverError: null, rawBody: stringifyBody(data) }
}

function isServerErrorBody(data: unknown): data is ServerErrorBody {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false
  const obj = data as Record<string, unknown>
  const hasCode = typeof obj['code'] === 'string'
  const hasMessage = typeof obj['message'] === 'string'
  return hasCode || hasMessage
}

function stringifyBody(data: unknown): string | undefined {
  try {
    return JSON.stringify(data)
  } catch {
    return undefined
  }
}

/**
 * Map a {@link ClassifierInput} onto the correct {@link ApiError} subclass.
 *
 * - `network` -> {@link NetworkError}
 * - `timeout` -> {@link TimeoutError}
 * - `http` 401 -> {@link AuthError} (`code: 'unauthorized'`)
 * - `http` 5xx / 429 -> {@link ApiError} (retryable via base getter)
 * - other `http` 4xx / statuses -> {@link ApiError}
 *
 * Structured bodies populate `serverError`; anything else becomes `rawBody`
 * (spec 6.12 & 6.1).
 */
export function classifyError(input: ClassifierInput): ApiError {
  switch (input.kind) {
    case 'network':
      return new NetworkError({
        message: networkMessage(input),
        request: input.request,
        cause: input.cause,
        corsBlocked: input.corsBlocked,
        partial: input.partial,
        offline: input.offline,
      })

    case 'timeout':
      return new TimeoutError({
        message: `Request timed out after ${input.timeoutMs}ms`,
        request: input.request,
        timeoutMs: input.timeoutMs,
      })

    case 'http': {
      const { serverError, rawBody } = extractServerError(input.data)
      const code = serverError?.code
      // A structured message is used verbatim; an unstructured body (e.g. an
      // HTML error page) is only used as a short, truncated hint so the message
      // never becomes an entire document (the full body stays in `rawBody`).
      const bodyHint =
        rawBody !== undefined ? truncate(rawBody.trim().replace(/\s+/g, ' '), 200) : undefined
      const baseMessage = serverError?.message ?? bodyHint ?? input.statusText

      if (input.status === 401) {
        return new AuthError({
          message: baseMessage || 'Unauthorized',
          status: 401,
          code: code ?? 'unauthorized',
          request: input.request,
          serverError,
          rawBody,
          responseHeaders: input.headers,
        })
      }

      return new ApiError({
        message: baseMessage || `HTTP ${input.status}`,
        status: input.status,
        code,
        request: input.request,
        serverError,
        rawBody,
        responseHeaders: input.headers,
      })
    }
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function networkMessage(input: NetworkFailure): string {
  if (input.offline) return 'Network request failed: offline'
  if (input.corsBlocked) return 'Network request failed: blocked by CORS'
  if (input.partial) return 'Network request failed: response interrupted'
  if (input.cause instanceof Error && input.cause.message) {
    return `Network request failed: ${input.cause.message}`
  }
  return 'Network request failed'
}
