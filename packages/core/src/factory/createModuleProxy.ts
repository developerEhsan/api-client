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

import { ApiError } from '../errors/ApiError';
import { ConfigurationError } from '../errors/ConfigurationError';
import type { PerCallConfig } from '../types/config.types';
import type { ApiResponse, HttpMethod } from '../types/http.types';
import type { ModuleContext, ModuleMethods, ModuleRequestSpec } from '../types/module.types';
import { isAbortError } from '../utilities/cancellation';
import { assertServerOnly } from '../utilities/serverOnly';

/** Executes a fully-specified request through the client pipeline. */
export type RequestRunner = <T = unknown>(
  spec: ModuleRequestSpec,
  origin: { moduleName: string; methodName: string },
  perCall?: PerCallConfig,
) => Promise<ApiResponse<T>>;

/** Static description of an auto-derived method (from the OpenAPI schema). */
export interface AutoMethodDescriptor {
  method: HttpMethod;
  /** Path template, e.g. `/invoices/{id}`. */
  path: string;
  /**
   * Tags this response is cached under, computed from the resolved call
   * input (spec 01). Tags are exact-match labels used only for
   * invalidation, never for gating read access to cached data.
   */
  cacheTags?: (args: AutoCallInput | undefined) => string[];
  /**
   * On success, tags to invalidate across the WHOLE process (every auth
   * scope), computed from the call input and the response body.
   */
  invalidatesTags?: (args: AutoCallInput | undefined, result: unknown) => string[];
  /**
   * Extra cache-key dimensions computed from the resolved call input (spec
   * 10) — e.g. an admin "viewing as" a target user, or the active workspace
   * in a multi-tenant dashboard. Folded into the cache key ALONGSIDE the
   * built-in tenant/auth-fingerprint scoping, never replacing it. A throw
   * here fails closed: caching is disabled for that one call.
   */
  cacheKeyParts?: (args: AutoCallInput | undefined) => Record<string, string>;
}

/** Argument accepted by an auto-derived exposed method. */
export interface AutoCallInput {
  pathParams?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: unknown;
}

/** Discriminated result returned by exposed methods when `safeMode` is on. */
export type SafeResult<T> = { success: true; data: T } | { success: false; error: ApiError };

/** Inputs used to assemble a module proxy. */
export interface ModuleProxyInput {
  moduleName: string;
  /** Auto-derived methods (may be empty until a schema is loaded). */
  autoDescriptors?: Record<string, AutoMethodDescriptor>;
  /**
   * Dynamic auto-descriptor source for `extends: 'auto'` against a runtime
   * schema that loads in the background. When present, auto methods resolve
   * lazily at access/call time from this function instead of the static
   * {@link ModuleProxyInput.autoDescriptors} map.
   */
  resolveAutoDescriptors?: () => Record<string, AutoMethodDescriptor> | undefined;
  /** True once the runtime schema has loaded (auto methods are then final). */
  isSchemaReady?: () => boolean;
  /** Resolves when the runtime schema has loaded (used to defer an early call). */
  whenSchemaReady?: () => Promise<void>;
  /** Custom methods; require {@link ModuleProxyInput.context}. */
  methods?: ModuleMethods;
  context?: ModuleContext;
  safeMode: boolean;
  /** See {@link import('../types/module.types').ModuleDefinition.serverOnly}. */
  serverOnly?: boolean;
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
]);

/** True when `name` may not be used as a module method name. */
export function isReservedMethodName(name: string): boolean {
  return RESERVED_METHOD_NAMES.has(name);
}

/**
 * Resolve `descriptor.cacheKeyParts(args)` into the spec fields `run` reads.
 * A throw fails closed (spec 10) — `cacheKeyPartsFailed: true` tells
 * `createClient.ts` to disable caching for this call rather than silently
 * dropping the extra scoping.
 */
function resolveCacheKeyParts(
  descriptor: AutoMethodDescriptor,
  input_: AutoCallInput | undefined,
): Pick<ModuleRequestSpec, 'cacheKeyParts' | 'cacheKeyPartsFailed'> {
  if (!descriptor.cacheKeyParts) return {};
  try {
    return { cacheKeyParts: descriptor.cacheKeyParts(input_) };
  } catch {
    return { cacheKeyPartsFailed: true };
  }
}

function toApiError(cause: unknown): ApiError {
  if (cause instanceof ApiError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  return new ApiError({ message, cause });
}

async function wrapSafe<T>(promise: Promise<T>): Promise<SafeResult<T>> {
  try {
    return { success: true, data: await promise };
  } catch (error) {
    // Aborts are re-thrown (never downgraded to a safe-result), preserving the
    // AbortError shape and the pipeline's X4 cancellation contract even in
    // safeMode.
    if (isAbortError(error)) throw error;
    return { success: false, error: toApiError(error) };
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
  const {
    moduleName,
    autoDescriptors,
    resolveAutoDescriptors,
    isSchemaReady,
    whenSchemaReady,
    methods,
    context,
    safeMode,
    serverOnly,
  } = input;

  // Checked once per module, at construction — not per call, for
  // performance (spec 06). Never reachable from a correctly-built browser
  // bundle in the first place; this is the dev-time net that catches an
  // accidental client-side import before CI's bundle grep would.
  if (serverOnly) assertServerOnly(`Module "${moduleName}"`);

  const target: Record<string, unknown> = {};

  const finalize = <T>(promise: Promise<T>): Promise<T> | Promise<SafeResult<T>> =>
    safeMode ? wrapSafe(promise) : promise;

  /** Build a callable for an auto method sourced from the runtime schema. */
  const makeDynamicAuto = (methodName: string) => {
    return (input_?: AutoCallInput, perCall?: PerCallConfig) =>
      finalize(
        (async () => {
          // Defer until the background schema load settles, so a call made
          // right after createClient still resolves the descriptor.
          if (whenSchemaReady) await whenSchemaReady();
          const descriptor = resolveAutoDescriptors?.()?.[methodName];
          if (!descriptor) {
            throw new ConfigurationError(
              `Module "${moduleName}" has no auto method "${methodName}" in the loaded schema.`,
            );
          }
          const spec: ModuleRequestSpec = {
            method: descriptor.method,
            path: descriptor.path,
            pathParams: input_?.pathParams,
            query: input_?.query,
            body: input_?.body,
            ...(descriptor.cacheTags ? { cacheTags: descriptor.cacheTags(input_) } : {}),
            ...(descriptor.invalidatesTags
              ? { resolveInvalidatesTags: (result: unknown) => descriptor.invalidatesTags!(input_, result) }
              : {}),
            ...resolveCacheKeyParts(descriptor, input_),
          };
          return (await run(spec, { moduleName, methodName }, perCall)).data;
        })(),
      );
  };

  if (autoDescriptors) {
    for (const [methodName, descriptor] of Object.entries(autoDescriptors)) {
      if (isReservedMethodName(methodName)) {
        throw new ConfigurationError(
          `Module "${moduleName}" cannot expose reserved method name "${methodName}".`,
        );
      }
      target[methodName] = (input_?: AutoCallInput, perCall?: PerCallConfig) => {
        const spec: ModuleRequestSpec = {
          method: descriptor.method,
          path: descriptor.path,
          pathParams: input_?.pathParams,
          query: input_?.query,
          body: input_?.body,
          ...(descriptor.cacheTags ? { cacheTags: descriptor.cacheTags(input_) } : {}),
          ...(descriptor.invalidatesTags
            ? { resolveInvalidatesTags: (result: unknown) => descriptor.invalidatesTags!(input_, result) }
            : {}),
          ...resolveCacheKeyParts(descriptor, input_),
        };
        return finalize(run(spec, { moduleName, methodName }, perCall).then((r) => r.data));
      };
    }
  }

  if (methods) {
    if (!context) {
      throw new ConfigurationError(
        `Module "${moduleName}" has custom methods but no ModuleContext was provided.`,
      );
    }
    for (const [methodName, fn] of Object.entries(methods)) {
      if (isReservedMethodName(methodName)) {
        throw new ConfigurationError(
          `Module "${moduleName}" cannot expose reserved method name "${methodName}".`,
        );
      }
      target[methodName] = (...args: unknown[]) => {
        // Convert synchronous throws into a rejected promise (M4).
        let promise: Promise<unknown>;
        try {
          promise = Promise.resolve(fn(context, ...(args as never[])));
        } catch (error) {
          promise = Promise.reject(toApiError(error));
        }
        return finalize(promise);
      };
    }
  }

  return new Proxy(target, {
    get(obj, prop, receiver): unknown {
      if (typeof prop === 'symbol') return Reflect.get(obj, prop, receiver);
      // Never masquerade as a thenable, even if awaited by mistake.
      if (prop === 'then') return undefined;
      // Custom + static-auto methods (own props) always win.
      if (Object.hasOwn(obj, prop)) return Reflect.get(obj, prop, receiver);
      // Dynamic auto methods from the runtime schema: expose a callable when the
      // descriptor already exists, or when the schema hasn't loaded yet (the
      // callable then awaits readiness and errors clearly if still absent).
      if (resolveAutoDescriptors && !isReservedMethodName(prop)) {
        const ready = isSchemaReady?.() ?? true;
        const hasDescriptor = resolveAutoDescriptors()?.[prop] !== undefined;
        if (hasDescriptor || !ready) return makeDynamicAuto(prop);
      }
      return Reflect.get(obj, prop, receiver);
    },
    set(): boolean {
      return false;
    },
  });
}
