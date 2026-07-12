/**
 * The request lifecycle pipeline. `createPipeline` wires an adapter, lifecycle
 * hooks, and the error classifier into an `execute` function that drives a
 * single request through the ordered lifecycle steps.
 *
 * Phase 1 scope (spec §5, steps 1-3, 9, 10, 11, 13, 14, 18): request
 * construction, `onRequest` hook, adapter dispatch with timeout, non-2xx
 * classification, response-envelope construction, and the `onResponse` hook.
 * Cache / dedup / queue / auth / retry / tenant stages are Phases 2-3 and are
 * marked with TODOs where they plug in.
 */

import type { ApiRequest, ApiResponse } from '../types/http.types'
import type { LifecycleHooks, ResolvedRequestConfig } from '../types/config.types'
import type { ModuleRequestSpec } from '../types/module.types'
import type { HttpAdapter } from './adapters/adapterInterface'
import type { ApiError } from '../errors/ApiError'
import type { ClassifierInput } from '../errors/errorClassifier'
import { TimeoutError } from '../errors/TimeoutError'
import { buildUrl } from '../utilities/urlBuilder'

/** Collaborators the pipeline depends on. Injected so it stays pure & testable. */
export interface PipelineDeps {
  adapter: HttpAdapter
  hooks?: LifecycleHooks
  classifyError: (input: ClassifierInput) => ApiError
}

/**
 * The discriminated result returned instead of throwing when
 * {@link ResolvedRequestConfig.safeMode} is enabled.
 */
export interface SafeModeError {
  success: false
  error: ApiError
}

/** A pipeline outcome: the response envelope, or a safe-mode error wrapper. */
export type PipelineResult<T> = ApiResponse<T> | SafeModeError

export interface Pipeline {
  execute<T>(
    spec: ModuleRequestSpec,
    resolvedConfig: ResolvedRequestConfig,
  ): Promise<PipelineResult<T>>
}

/** True for a successful HTTP status (2xx). */
function isSuccess(status: number): boolean {
  return status >= 200 && status < 300
}

/**
 * Construct a {@link Pipeline}. The returned `execute` runs the Phase 1
 * lifecycle for one request.
 */
export function createPipeline(deps: PipelineDeps): Pipeline {
  const { adapter, hooks, classifyError } = deps

  async function execute<T>(
    spec: ModuleRequestSpec,
    resolvedConfig: ResolvedRequestConfig,
  ): Promise<PipelineResult<T>> {
    // TODO(Phase 3): tenant resolution — inject resolved tenantId header.
    // TODO(Phase 3): auth stage — apply AuthConfig (bearer/apiKey/oauth2/cookie).
    // TODO(Phase 2): cache lookup — short-circuit on hit per CacheStrategy.
    // TODO(Phase 2): dedup — coalesce identical in-flight requests.
    // TODO(Phase 2): queue — gate concurrency before dispatch.

    // Step 1-3: request construction.
    const url = buildUrl({
      baseURL: resolvedConfig.baseURL,
      path: spec.path,
      pathParams: spec.pathParams,
      query: spec.query,
    })

    let request: ApiRequest = {
      url,
      method: spec.method,
      headers: { ...resolvedConfig.headers },
      responseType: resolvedConfig.responseType,
      timeout: resolvedConfig.timeout,
    }
    if (spec.body !== undefined) request.body = spec.body
    if (spec.query !== undefined) request.query = spec.query
    if (spec.pathParams !== undefined) request.pathParams = spec.pathParams
    if (resolvedConfig.tenantId !== undefined) request.tenantId = resolvedConfig.tenantId

    // Step 9: onRequest hook — may rewrite the outgoing request.
    if (hooks?.onRequest) {
      request = await hooks.onRequest(request)
    }

    try {
      // Step 10-11: dispatch through the adapter with timeout enforcement.
      const adapterResponse = await dispatch(request, resolvedConfig)

      // Step 13: classify non-2xx into a typed error.
      if (!isSuccess(adapterResponse.status)) {
        const error = classifyError({
          kind: 'http',
          status: adapterResponse.status,
          statusText: adapterResponse.statusText,
          headers: adapterResponse.headers,
          data: adapterResponse.data,
          request,
        })
        return await fail(error, resolvedConfig)
      }

      // Step 14: build the response envelope. 204/empty bodies surface as null.
      const data = (adapterResponse.data ?? null) as T
      let response: ApiResponse<T> = {
        data,
        status: adapterResponse.status,
        statusText: adapterResponse.statusText,
        headers: adapterResponse.headers,
        fromCache: false,
      }

      // TODO(Phase 4): schema validation of the response body.
      // TODO(Phase 2): cache write on success.

      // Step 18: onResponse hook — may transform the envelope.
      if (hooks?.onResponse) {
        response = await hooks.onResponse<T>(response)
      }

      return response
    } catch (caught) {
      // Typed errors (e.g. TimeoutError from dispatch) pass through; thrown
      // transport failures are classified as network failures via the
      // injected classifier.
      const error = isApiError(caught)
        ? caught
        : classifyError({ kind: 'network', cause: caught, request })
      return await fail(error, resolvedConfig)
    }
  }

  /**
   * Emit the `onError` hook, then either return the safe-mode wrapper or
   * rethrow, per {@link ResolvedRequestConfig.safeMode}.
   */
  async function fail<T>(
    error: ApiError,
    resolvedConfig: ResolvedRequestConfig,
  ): Promise<PipelineResult<T>> {
    if (hooks?.onError) await hooks.onError(error)
    if (resolvedConfig.safeMode) return { success: false, error }
    throw error
  }

  /**
   * Dispatch through the adapter, enforcing the configured timeout via an
   * {@link AbortController}. Fires a {@link TimeoutError} when the timer wins.
   */
  async function dispatch(
    request: ApiRequest,
    resolvedConfig: ResolvedRequestConfig,
  ): Promise<Awaited<ReturnType<HttpAdapter['send']>>> {
    // TODO(Phase 3): retry loop wraps this dispatch (RetryConfig/backoff).
    const timeoutMs = resolvedConfig.timeout
    const controller = new AbortController()
    let timedOut = false

    const external = resolvedConfig.signal
    const onExternalAbort = (): void => controller.abort()
    if (external) {
      if (external.aborted) controller.abort()
      else external.addEventListener('abort', onExternalAbort, { once: true })
    }

    const timer: ReturnType<typeof setTimeout> | undefined =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            controller.abort()
          }, timeoutMs)
        : undefined

    const dispatched: ApiRequest = { ...request, signal: controller.signal }

    try {
      return await adapter.send(dispatched)
    } catch (caught) {
      if (timedOut) {
        throw new TimeoutError({
          message: `Request timed out after ${timeoutMs}ms`,
          request,
          timeoutMs,
        })
      }
      throw caught
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (external) external.removeEventListener('abort', onExternalAbort)
    }
  }

  return { execute }
}

/** Structural check for an {@link ApiError} without importing the class value. */
function isApiError(value: unknown): value is ApiError {
  return (
    value instanceof Error &&
    'isRetryable' in value &&
    'serverError' in value
  )
}
