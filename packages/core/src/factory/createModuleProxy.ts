/**
 * Builds the ES `Proxy` that backs a single module on `api.<module>`.
 *
 * Two method sources are supported and merged (custom overrides auto, spec M2):
 *  - **auto** descriptors ({@link AutoMethodDescriptor}) derived from the
 *    OpenAPI schema — invoking one runs the request pipeline directly.
 *  - **custom** {@link ModuleMethods} — invoked with a bound
 *    {@link ModuleContext} as the (stripped) first argument.
 *
 * Synchronous throws from a custom method are converted to a rejected promise
 * (spec M4). Reserved / thenable-sensitive names are blocked.
 */

import type { ApiResponse, HttpMethod } from '../types/http.types'
import type { PerCallConfig } from '../types/config.types'
import type {
  ModuleContext,
  ModuleMethods,
  ModuleRequestSpec,
} from '../types/module.types'
import { ApiError } from '../errors/ApiError'
import { ConfigurationError } from '../errors/ConfigurationError'
import { isAbortError } from '../utilities/cancellation'

/** Executes a fully-specified request through the client pipeline. */
export type RequestRunner = <T = unknown>(
  spec: ModuleRequestSpec,
  origin: { moduleName: string; methodName: string },
  perCall?: PerCallConfig,
) => Promise<ApiResponse<T>>

/** Static description of an auto-derived method (from the OpenAPI schema). */
export interface AutoMethodDescriptor {
  method: HttpMethod
  /** Path template, e.g. `/invoices/{id}`. */
  path: string
}

/** Argument accepted by an auto-derived exposed method. */
export interface AutoCallInput {
  pathParams?: Record<string, string | number>
  query?: Record<string, unknown>
  body?: unknown
}

/** Discriminated result returned by exposed methods when `safeMode` is on. */
export type SafeResult<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError }

/** Inputs used to assemble a module proxy. */
export interface ModuleProxyInput {
  moduleName: string
  /** Auto-derived methods (may be empty until a schema is loaded). */
  autoDescriptors?: Record<string, AutoMethodDescriptor>
  /** Custom methods; require {@link ModuleProxyInput.context}. */
  methods?: ModuleMethods
  context?: ModuleContext
  safeMode: boolean
}

/**
 * Names that must never be exposed as methods: `then`/`catch`/`finally` would
 * make the proxy a mistaken thenable, and the rest are prototype-pollution or
 * footgun vectors.
 */
const RESERVED_METHOD_NAMES: ReadonlySet<string> = new Set([
  'then',
  'catch',
  'finally',
  'constructor',
  'prototype',
  '__proto__',
])

/** True when `name` may not be used as a module method name. */
export function isReservedMethodName(name: string): boolean {
  return RESERVED_METHOD_NAMES.has(name)
}

function toApiError(cause: unknown): ApiError {
  if (cause instanceof ApiError) return cause
  const message = cause instanceof Error ? cause.message : String(cause)
  return new ApiError({ message, cause })
}

async function wrapSafe<T>(promise: Promise<T>): Promise<SafeResult<T>> {
  try {
    return { success: true, data: await promise }
  } catch (error) {
    // Aborts are re-thrown (never downgraded to a safe-result), preserving the
    // AbortError shape and the pipeline's X4 cancellation contract even in
    // safeMode.
    if (isAbortError(error)) throw error
    return { success: false, error: toApiError(error) }
  }
}

/**
 * Assemble the module proxy. Returns a namespace object whose methods run the
 * pipeline via `run`. Custom method names win over auto ones (M2).
 *
 * @throws {ConfigurationError} when a method uses a reserved name.
 */
export function createModuleProxy(
  input: ModuleProxyInput,
  run: RequestRunner,
): Record<string, unknown> {
  const { moduleName, autoDescriptors, methods, context, safeMode } = input
  const target: Record<string, unknown> = {}

  const finalize = <T>(promise: Promise<T>): Promise<T> | Promise<SafeResult<T>> =>
    safeMode ? wrapSafe(promise) : promise

  if (autoDescriptors) {
    for (const [methodName, descriptor] of Object.entries(autoDescriptors)) {
      if (isReservedMethodName(methodName)) {
        throw new ConfigurationError(
          `Module "${moduleName}" cannot expose reserved method name "${methodName}".`,
        )
      }
      target[methodName] = (input_?: AutoCallInput, perCall?: PerCallConfig) => {
        const spec: ModuleRequestSpec = {
          method: descriptor.method,
          path: descriptor.path,
          pathParams: input_?.pathParams,
          query: input_?.query,
          body: input_?.body,
        }
        return finalize(
          run(spec, { moduleName, methodName }, perCall).then((r) => r.data),
        )
      }
    }
  }

  if (methods) {
    if (!context) {
      throw new ConfigurationError(
        `Module "${moduleName}" has custom methods but no ModuleContext was provided.`,
      )
    }
    for (const [methodName, fn] of Object.entries(methods)) {
      if (isReservedMethodName(methodName)) {
        throw new ConfigurationError(
          `Module "${moduleName}" cannot expose reserved method name "${methodName}".`,
        )
      }
      target[methodName] = (...args: unknown[]) => {
        // Convert synchronous throws into a rejected promise (M4).
        let promise: Promise<unknown>
        try {
          promise = Promise.resolve(fn(context, ...(args as never[])))
        } catch (error) {
          promise = Promise.reject(toApiError(error))
        }
        return finalize(promise)
      }
    }
  }

  return new Proxy(target, {
    get(obj, prop, receiver): unknown {
      if (typeof prop === 'symbol') return Reflect.get(obj, prop, receiver)
      // Never masquerade as a thenable, even if awaited by mistake.
      if (prop === 'then') return undefined
      return Reflect.get(obj, prop, receiver)
    },
    set(): boolean {
      return false
    },
  })
}
