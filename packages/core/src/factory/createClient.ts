/**
 * `createClient` — the public factory. Validates configuration eagerly, selects
 * an HTTP adapter for the detected runtime, builds the request pipeline, and
 * returns a `Proxy`-backed client exposing modules plus utility members.
 *
 * Retry / cache / dedup / schema-loading are Phase 3+/Phase 6 concerns and are
 * stubbed with TODOs here.
 */

import type { AdapterName } from '../environment/edgeSafe';
import type { HttpAdapter } from '../http/adapters/adapterInterface';
import type { AuthConfig } from '../types/auth.types';
import type { CacheEntry } from '../types/cache.types';
import type {
  GlobalConfig,
  HttpAdapterLike,
  ModuleConfig,
  ModulesConfig,
  PerCallConfig,
} from '../types/config.types';
import type { ApiRequest, ApiResponse } from '../types/http.types';
import type { ModuleContext, ModuleDefinition, ModuleRequestSpec } from '../types/module.types';
import type { SchemaAST } from '../types/openapi.types';

import { type AuthManager, createAuthManager } from '../auth/authManager';
import { validateResponseBody } from '../codegen/schemaValidator';
import { detectEnvironment } from '../environment/detect';
import { assertFetchAvailable, resolveAdapterName } from '../environment/edgeSafe';
import { ApiError } from '../errors/ApiError';
import { ConfigurationError } from '../errors/ConfigurationError';
import { SchemaError } from '../errors/SchemaError';
import { TimeoutError } from '../errors/TimeoutError';
import { classifyError } from '../errors/errorClassifier';
import { createAxiosAdapter } from '../http/adapters/axiosAdapter';
import { createFetchAdapter } from '../http/adapters/fetchAdapter';
import {
  type LoggingHooks,
  createLoggingInterceptor,
} from '../http/interceptors/logging.interceptor';
import { createSchemaCache } from '../runtime/schemaCache';
import { createSchemaLoader } from '../runtime/schemaLoader';
import { resolveTenantId } from '../tenancy/tenantManager';
import { computeCacheKey, createCache, isFresh } from '../utilities/cache';
import { createCancellationManager, isAbortError } from '../utilities/cancellation';
import { computeDedupeKey, createDeduplicator } from '../utilities/deduplicator';
import { createQueue } from '../utilities/queue';
import { type ResolvedRetryOptions, withRetry } from '../utilities/retry';
import { buildUrl, serializeQuery } from '../utilities/urlBuilder';
import { isModuleDefinition } from './createModule';
import {
  type AutoMethodDescriptor,
  type RequestRunner,
  createModuleProxy,
} from './createModuleProxy';
import { resolveRequestConfig } from './mergeModuleConfig';

/** Cache facade exposed on `client.cache`, backed by the client's LRU store. */
export interface ClientCache {
  /** Invalidate entries matching a glob pattern (e.g. `invoices.*`); no arg clears all. */
  invalidate(pattern?: string): void;
  clear(): void;
  get(key: string): CacheEntry | undefined;
}

/** Live configuration accessor exposed on `client.config`. */
export interface ClientConfigApi {
  get(): Readonly<GlobalConfig>;
  update(patch: Partial<GlobalConfig>): void;
}

export type ClientEventListener = (payload: unknown) => void;

/**
 * The client surface. Modules are dynamically added string keys; the reserved
 * utility members below always take precedence.
 */
export interface ApiClient {
  readonly cache: ClientCache;
  readonly config: ClientConfigApi;
  setEnvironment(name: string): void;
  getSchema(): SchemaAST | undefined;
  on(event: string, listener: ClientEventListener): void;
  off(event: string, listener: ClientEventListener): void;
  [module: string]: unknown;
}

const RESERVED_CLIENT_MEMBERS: ReadonlySet<string> = new Set([
  'cache',
  'config',
  'setEnvironment',
  'getSchema',
  'on',
  'off',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isAdapterLike(value: unknown): value is HttpAdapterLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { send?: unknown }).send === 'function'
  );
}

/** Eager configuration validation (spec E1, R7). */
function validateConfig(config: GlobalConfig): void {
  if (!isPlainObject(config)) {
    throw new ConfigurationError('createClient expects a configuration object.');
  }
  if (!isPlainObject(config.openapi)) {
    throw new ConfigurationError('createClient requires an "openapi" configuration block (R7).');
  }
  const hasBaseURL = typeof config.baseURL === 'string' && config.baseURL.length > 0;
  const hasEnv = typeof config.activeEnvironment === 'string';
  if (!hasBaseURL && !hasEnv) {
    throw new ConfigurationError(
      'createClient requires either "baseURL" or "activeEnvironment" to be set (R7).',
    );
  }
  if (hasEnv) {
    const environments = config.environments;
    if (!environments || environments[config.activeEnvironment as string] === undefined) {
      throw new ConfigurationError(
        `activeEnvironment "${String(config.activeEnvironment)}" is not present in the environments map (E1).`,
      );
    }
  }
}

/** Instantiate the HTTP adapter appropriate for the runtime (R1). */
function instantiateAdapter(config: GlobalConfig): HttpAdapter {
  const requested = config.http?.adapter;
  if (isAdapterLike(requested)) {
    // Custom adapter object: HttpAdapterLike is structurally an HttpAdapter.
    return { send: (request) => requested.send(request) };
  }

  const env = detectEnvironment();
  const requestedName: AdapterName = requested === 'fetch' ? 'fetch' : 'axios';
  const resolved = resolveAdapterName(requestedName, env);

  if (resolved === 'fetch') {
    assertFetchAvailable(env);
    return createFetchAdapter();
  }
  return createAxiosAdapter();
}

/** Extract the custom module definitions keyed by module name. */
function collectModuleDefinitions(
  modules: ModulesConfig | undefined,
): Record<string, ModuleDefinition> {
  const out: Record<string, ModuleDefinition> = {};
  if (!modules) return out;
  for (const [name, value] of Object.entries(modules)) {
    if (name === 'auto') continue;
    if (isModuleDefinition(value)) {
      out[name] = value;
    } else if (isPlainObject(value) && isPlainObject((value as { methods?: unknown }).methods)) {
      // Tolerate an un-branded but structurally-valid definition.
      out[name] = value as unknown as ModuleDefinition;
    }
  }
  return out;
}

/**
 * Create a configured API client.
 *
 * The dynamic (untyped) factory: modules and their methods are declared inline
 * via {@link defineModule}, and calls return `Promise<Result>`. For full type
 * inference from generated codegen output, use `createTypedClient` instead.
 *
 * @throws {ConfigurationError} for invalid configuration, detected eagerly.
 *
 * @example
 * ```ts
 * import { createClient, defineModule } from '@developerehsan/api-client'
 *
 * const api = createClient({
 *   baseURL: 'https://petstore3.swagger.io/api/v3',
 *   openapi: { mode: 'runtime' },
 *   modules: {
 *     pet: defineModule({
 *       methods: {
 *         getPetById: (ctx, petId: number) =>
 *           ctx.request({ method: 'GET', path: '/pet/{petId}', pathParams: { petId } }),
 *       },
 *     }),
 *   },
 * })
 *
 * const res = await api.pet.getPetById(1) // -> Promise<ApiResponse<unknown>>
 * ```
 */
export function createClient(config: GlobalConfig): ApiClient {
  validateConfig(config);

  // Mutable working copy so `setEnvironment` / `config.update` can mutate.
  let currentConfig: GlobalConfig = { ...config };
  const adapter = instantiateAdapter(currentConfig);

  const moduleDefinitions = collectModuleDefinitions(currentConfig.modules);
  const moduleConfigs: Record<string, ModuleConfig | undefined> = {};
  for (const [name, def] of Object.entries(moduleDefinitions)) {
    moduleConfigs[name] = def.config;
  }

  // --- Event emitter -------------------------------------------------------
  const listeners = new Map<string, Set<ClientEventListener>>();
  const emit = (event: string, payload: unknown): void => {
    const set = listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(payload);
      } catch {
        // Listener errors must not break the pipeline.
      }
    }
  };

  // --- Auth manager --------------------------------------------------------
  // Single instance per client: holds the shared OAuth2 refresh mutex so
  // concurrent 401s trigger exactly one refresh (spec 6.2).
  const authManager: AuthManager = createAuthManager({
    adapter,
    classifyError,
  });

  // --- Dev logging ---------------------------------------------------------
  const logging: LoggingHooks | undefined =
    currentConfig.dev?.logging !== undefined && currentConfig.dev.logging !== false
      ? createLoggingInterceptor(currentConfig.dev.logging)
      : undefined;

  // --- Client-level utility singletons -------------------------------------
  // Shared across all requests so dedup/queue/cache coordinate globally.
  const deduplicator = createDeduplicator();
  const cacheStore = createCache({
    maxSize: currentConfig.cache?.maxSize ?? 500,
    ...(currentConfig.cache?.onEvict ? { onEvict: currentConfig.cache.onEvict } : {}),
  });
  const queue = createQueue({
    concurrency: currentConfig.http?.queue?.concurrency ?? 10,
    priority: currentConfig.http?.queue?.priority ?? 'fifo',
  });
  const queueEnabled = currentConfig.http?.queue?.enabled ?? true;
  const cancellation = createCancellationManager({
    dedupeWindow: currentConfig.cancellation?.dedupeWindow ?? 0,
  });

  // --- Runtime schema (dev mode) -------------------------------------------
  // Loaded in the background from openapi.runtimeURL; powers getSchema() and
  // response validation. Never blocks createClient (which stays synchronous).
  const schemaCache = createSchemaCache();
  {
    const oa = currentConfig.openapi;
    const wantsRuntime = oa.mode !== 'codegen' && typeof oa.runtimeURL === 'string';
    if (wantsRuntime && oa.runtimeURL) {
      const loader = createSchemaLoader({ cache: schemaCache });
      void loader.load(oa.runtimeURL).catch(() => undefined);
      const interval = currentConfig.dev?.schemaRefreshInterval;
      if (typeof interval === 'number' && interval > 0) {
        const driftPolicy = {
          mode: oa.validation?.mode ?? 'loose',
          ...(oa.validation?.onDriftDetected
            ? { onDriftDetected: oa.validation.onDriftDetected }
            : {}),
        };
        loader.startPolling(oa.runtimeURL, interval, driftPolicy);
      }
    }
  }

  /** Methods eligible for dedup/cache. GET is always eligible. */
  const dedupeMethods = new Set(
    (currentConfig.http?.dedupeMethod ?? ['GET']).map((m) => m.toUpperCase()),
  );
  const dedupEnabled = currentConfig.http?.deduplication ?? true;

  /**
   * A cheap, non-secret fingerprint of the active auth so cache/dedup keys never
   * collide across users/tenants (spec C8). Bearer/OAuth2 hash the token.
   * Returns `null` when the credential cannot be resolved (getter threw) — the
   * caller then disables cache + dedup for that request rather than sharing it
   * under an ambiguous key.
   */
  const authFingerprint = async (auth: AuthConfig): Promise<string | null> => {
    try {
      switch (auth.strategy) {
        case 'bearer':
          return `bearer:${(await auth.getToken()) ?? ''}`;
        case 'oauth2':
          return `oauth2:${(await auth.getAccessToken()) ?? ''}`;
        case 'apiKey':
          return `apikey:${await auth.getKey()}`;
        case 'cookie':
          return 'cookie';
        default:
          return 'none';
      }
    } catch {
      return null;
    }
  };

  // --- Request pipeline ----------------------------------------------------
  const run: RequestRunner = async <T = unknown>(
    spec: ModuleRequestSpec,
    origin: { moduleName: string; methodName: string },
    perCall?: PerCallConfig,
  ): Promise<ApiResponse<T>> => {
    const resolved = resolveRequestConfig(currentConfig, moduleConfigs[origin.moduleName], perCall);

    // Auth-independent request pieces, computed once and reused across a
    // post-refresh retry.
    const baseHeaders: Record<string, string> = { ...resolved.headers };
    const baseQuery: Record<string, unknown> = { ...spec.query };

    // Tenancy: resolve per precedence (per-call > resolver > ALS context),
    // then inject the header when a tenant id was resolved (spec T1-T5).
    const perCallTenant = perCall?.tenantId ?? resolved.tenantId;
    const tenantId = await resolveTenantId({
      ...(perCallTenant !== undefined ? { perCall: perCallTenant } : {}),
      ...(typeof resolved.tenancy.getTenantId === 'function'
        ? { getTenantId: resolved.tenancy.getTenantId }
        : {}),
    });
    if (tenantId !== undefined && tenantId !== '') {
      baseHeaders[resolved.tenancy.headerName ?? 'X-Tenant-ID'] = tenantId;
    }

    // Auth-independent identity URL — the basis for stable dedup & cache keys
    // (auth query params are excluded so they never fragment the key).
    const identityUrl = buildUrl({
      baseURL: resolved.baseURL,
      path: spec.path,
      pathParams: spec.pathParams,
      query: serializeQuery(baseQuery).length > 0 ? baseQuery : undefined,
    });

    // Cancellation: with a dedupeWindow, a newer call for the same identity
    // aborts the previous in-flight one (debounce-cancel, spec X3). The
    // returned signal also merges any caller-supplied signal.
    let effectiveSignal = resolved.signal;
    let settleCancel: () => void = () => undefined;
    if ((currentConfig.cancellation?.dedupeWindow ?? 0) > 0) {
      const acquired = cancellation.acquire(identityUrl, resolved.signal);
      effectiveSignal = acquired.signal;
      settleCancel = acquired.settle;
    }

    /**
     * Build and dispatch one attempt. Auth is resolved fresh each call so a
     * retry after a token refresh injects the new access token. Only throws
     * {@link ApiError} subclasses (auth failure, or a classified network error).
     */
    const attempt = async (): Promise<{
      request: ApiRequest;
      raw: Awaited<ReturnType<HttpAdapter['send']>>;
    }> => {
      const auth = await authManager.resolve(resolved.auth, resolved.skipAuth);
      const headers: Record<string, string> = {
        ...baseHeaders,
        ...auth.headers,
      };
      const query: Record<string, unknown> = { ...baseQuery, ...auth.query };

      const url = buildUrl({
        baseURL: resolved.baseURL,
        path: spec.path,
        pathParams: spec.pathParams,
        query: serializeQuery(query).length > 0 ? query : undefined,
      });

      const request: ApiRequest = {
        url,
        method: spec.method,
        headers,
        responseType: resolved.responseType,
        timeout: resolved.timeout,
        moduleName: origin.moduleName,
        methodName: origin.methodName,
      };
      if (spec.body !== undefined) request.body = spec.body;
      if (spec.query !== undefined) request.query = spec.query;
      if (spec.pathParams !== undefined) request.pathParams = spec.pathParams;
      if (effectiveSignal !== undefined) request.signal = effectiveSignal;
      if (tenantId !== undefined) request.tenantId = tenantId;
      if (auth.cookie) request.meta = { ...request.meta, cookieAuth: true };

      let outgoing = request;
      if (logging) outgoing = logging.onRequest(outgoing);
      if (typeof currentConfig.hooks?.onRequest === 'function') {
        outgoing = await currentConfig.hooks.onRequest(outgoing);
      }
      emit('request', outgoing);

      // Timeout enforcement (spec N1). Adapters (esp. fetch) do not all honor
      // `timeout` on their own, so we drive an AbortController here and merge it
      // with any caller/debounce signal. Applied per attempt, so each retry gets
      // a fresh timeout budget.
      const timeoutMs = resolved.timeout;
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const externalSignal = outgoing.signal;
      let onExternalAbort: (() => void) | undefined;
      if (timeoutMs > 0) {
        const controller = new AbortController();
        if (externalSignal) {
          if (externalSignal.aborted) controller.abort();
          else {
            onExternalAbort = () => controller.abort();
            externalSignal.addEventListener('abort', onExternalAbort, {
              once: true,
            });
          }
        }
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
        outgoing = { ...outgoing, signal: controller.signal };
      }

      let raw: Awaited<ReturnType<HttpAdapter['send']>>;
      try {
        raw = await adapter.send(outgoing);
      } catch (cause) {
        if (timedOut) {
          throw new TimeoutError({
            message: `Request timed out after ${timeoutMs}ms`,
            request: outgoing,
            timeoutMs,
          });
        }
        throw classifyError({ kind: 'network', cause, request: outgoing });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (onExternalAbort && externalSignal) {
          externalSignal.removeEventListener('abort', onExternalAbort);
        }
      }
      return { request: outgoing, raw };
    };

    const reportError = async (error: ApiError): Promise<never> => {
      if (logging) logging.onError(error);
      emit('error', error);
      await currentConfig.hooks?.onError?.(error);
      throw error;
    };

    const toApiError = (caught: unknown): ApiError =>
      caught instanceof ApiError
        ? caught
        : new ApiError({
            message: 'Request failed before dispatch.',
            cause: caught,
          });

    // Retry options resolved for this request (defaults applied upstream).
    const retryOpts: ResolvedRetryOptions = {
      attempts: resolved.retry.attempts,
      backoff: resolved.retry.backoff,
      baseDelay: resolved.retry.baseDelay,
      maxDelay: resolved.retry.maxDelay,
      jitter: resolved.retry.jitter,
      ...(resolved.retry.retryOn ? { retryOn: resolved.retry.retryOn } : {}),
      ...(resolved.retry.onRetry ? { onRetry: resolved.retry.onRetry } : {}),
    };

    // Retry loop around attempt(): retryable statuses (5xx/429) are thrown so
    // withRetry backs off; every other status returns its raw response.
    const dispatchWithRetry = (): Promise<{
      request: ApiRequest;
      raw: Awaited<ReturnType<HttpAdapter['send']>>;
    }> =>
      withRetry(
        async () => {
          const result = await attempt();
          const { status, statusText, headers, data } = result.raw;
          if (status >= 500 || status === 429) {
            throw classifyError({
              kind: 'http',
              status,
              statusText,
              headers,
              data,
              request: result.request,
            });
          }
          return result;
        },
        retryOpts,
        effectiveSignal ? { signal: effectiveSignal } : {},
      );

    // Full network path: retry -> 401 refresh (retry once) -> response envelope.
    const runNetwork = async (): Promise<ApiResponse<T>> => {
      let { request, raw } = await dispatchWithRetry();

      // 401 -> OAuth2 refresh -> retry ONCE (no re-refresh; spec 6.2).
      if (raw.status === 401 && !resolved.skipAuth) {
        const refreshed = await authManager.handleUnauthorized(resolved.auth);
        if (refreshed) ({ request, raw } = await dispatchWithRetry());
      }

      if (raw.status >= 400) {
        throw classifyError({
          kind: 'http',
          status: raw.status,
          statusText: raw.statusText,
          headers: raw.headers,
          data: raw.data,
          request,
        });
      }

      // Response validation against the runtime schema (spec step 12, S4/S5).
      // Best-effort: only runs when validation is enabled and a matching
      // operation is present in the loaded schema.
      if (resolved.validation.enabled) {
        const ast = schemaCache.get();
        if (ast) {
          const result = validateResponseBody(ast, spec.path, spec.method, raw.status, raw.data);
          if (!result.valid) {
            const message = `Response validation failed for ${spec.method} ${spec.path}: ${result.errors.join('; ')}`;
            if ((resolved.validation.mode ?? 'loose') === 'strict') {
              throw new SchemaError({ message, request });
            }
            console.warn(`[@developerehsan/api-client] ${message}`);
          }
        }
      }

      let response: ApiResponse<T> = {
        data: (raw.data ?? null) as T,
        status: raw.status,
        statusText: raw.statusText,
        headers: raw.headers,
        fromCache: false,
      };
      if (logging) response = logging.onResponse(response);
      if (typeof currentConfig.hooks?.onResponse === 'function') {
        response = (await currentConfig.hooks.onResponse(response)) as ApiResponse<T>;
      }
      emit('response', response);
      return response;
    };

    // Concurrency queue (step 5) and dedup (step 6) wrappers.
    const withQueue = <R>(work: () => Promise<R>): Promise<R> =>
      queueEnabled ? queue.add(work, effectiveSignal ? { signal: effectiveSignal } : {}) : work();

    const method = spec.method.toUpperCase();
    const isGet = method === 'GET';
    const dedupApplies = dedupEnabled && !resolved.skipDedup && dedupeMethods.has(method);
    const cacheConfigured = isGet && resolved.cache.enabled !== false;

    // Single auth fingerprint shared by cache + dedup keys (spec C8). When it
    // cannot be resolved (getter threw), scoping is unsafe: disable cache+dedup
    // so this request is never shared under an ambiguous key.
    let fp: string | null = 'none';
    if (cacheConfigured || dedupApplies) fp = await authFingerprint(resolved.auth);
    const scopable = fp !== null;

    const withDedup = <R>(work: () => Promise<R>): Promise<R> => {
      if (!dedupApplies || !scopable) return work();
      const key = computeDedupeKey({
        method,
        url: identityUrl,
        body: spec.body,
        ...(tenantId !== undefined ? { tenantId } : {}),
        ...(fp !== null ? { authFingerprint: fp } : {}),
      });
      return deduplicator.dedupe(key, work);
    };

    // --- Cache layer (GET only) ---------------------------------------------
    const cacheEligible = cacheConfigured && scopable;
    const cacheTtl = resolved.cache.ttl ?? 60_000;
    const cacheStrategy = resolved.cache.strategy ?? 'cache-first';
    const cacheBust = resolved.cache.bust === true;

    const emitCacheHit = (key: string, entry: CacheEntry): void => {
      currentConfig.hooks?.onCacheHit?.(key, entry);
      emit('cacheHit', { key, entry });
    };
    const emitCacheMiss = (key: string): void => {
      currentConfig.hooks?.onCacheMiss?.(key);
      emit('cacheMiss', { key });
    };
    const toCacheResponse = (entry: CacheEntry): ApiResponse<T> => ({
      data: entry.data as T,
      status: entry.status,
      statusText: '',
      headers: entry.headers,
      fromCache: true,
    });

    let cacheKey: string | undefined;
    if (cacheEligible) {
      cacheKey = computeCacheKey({
        method,
        url: identityUrl,
        ...(tenantId !== undefined ? { tenantId } : {}),
        ...(fp !== null ? { authFingerprint: fp } : {}),
      });
    }
    if (cacheKey && cacheBust) cacheStore.delete(cacheKey);

    // Fetch through queue + dedup, then write-through to cache on success.
    const fetchThrough = (): Promise<ApiResponse<T>> =>
      withQueue(() =>
        withDedup(async () => {
          const response = await runNetwork();
          if (cacheKey) {
            const now = Date.now();
            cacheStore.set(cacheKey, {
              key: cacheKey,
              data: response.data,
              status: response.status,
              headers: response.headers,
              storedAt: now,
              expiresAt: now + cacheTtl,
            });
          }
          return response;
        }),
      );

    try {
      if (cacheKey && !cacheBust) {
        const entry = cacheStore.get(cacheKey);

        if (cacheStrategy === 'network-first') {
          try {
            return await fetchThrough();
          } catch (caught) {
            // An abort must surface to the caller, never be masked by stale
            // cache (X4). Only genuine failures fall back to cache.
            if (isAbortError(caught)) throw caught;
            if (entry) {
              emitCacheHit(cacheKey, entry);
              return toCacheResponse(entry);
            }
            throw caught;
          }
        }

        // cache-first & stale-while-revalidate.
        if (entry) {
          if (isFresh(entry, Date.now())) {
            emitCacheHit(cacheKey, entry);
            return toCacheResponse(entry);
          }
          if (cacheStrategy === 'stale-while-revalidate') {
            emitCacheHit(cacheKey, entry);
            // Background revalidation; keep the stale entry if it fails (C2).
            void fetchThrough().catch(() => undefined);
            return toCacheResponse(entry);
          }
          // cache-first + stale entry: fall through to a live fetch.
        } else {
          emitCacheMiss(cacheKey);
        }
      }

      return await fetchThrough();
    } catch (caught) {
      // Aborts surface as-is (X4: swallow is the caller's concern); everything
      // else is normalized and reported through hooks/events.
      if (isAbortError(caught)) throw caught;
      return reportError(toApiError(caught));
    } finally {
      settleCancel();
    }
  };

  // --- Module proxies ------------------------------------------------------
  const client: Record<string, unknown> = {};

  for (const [name, definition] of Object.entries(moduleDefinitions)) {
    if (RESERVED_CLIENT_MEMBERS.has(name)) {
      throw new ConfigurationError(`Module name "${name}" collides with a reserved client member.`);
    }

    const context: ModuleContext = {
      request: (spec, perCall) => run(spec, { moduleName: name, methodName: 'request' }, perCall),
      client: undefined,
      moduleName: name,
    };

    // TODO(Phase 6): populate auto descriptors from the loaded schema when
    // `definition.extends === 'auto'` or `modules.auto === true`.
    const autoDescriptors: Record<string, AutoMethodDescriptor> = {};

    client[name] = createModuleProxy(
      {
        moduleName: name,
        autoDescriptors: definition.extends === 'auto' ? autoDescriptors : undefined,
        methods: definition.methods,
        context,
        safeMode: currentConfig.safeMode ?? false,
      },
      run,
    );

    // Late-bind the client reference for composed cross-module calls.
    (context as { client: unknown }).client = client;
  }

  // --- Utility members -----------------------------------------------------
  const cache: ClientCache = {
    invalidate: (pattern?: string) => {
      if (pattern === undefined) cacheStore.clear();
      else cacheStore.invalidate(pattern);
    },
    clear: () => cacheStore.clear(),
    get: (key: string) => cacheStore.get(key),
  };

  const configApi: ClientConfigApi = {
    get: () => Object.freeze({ ...currentConfig }),
    update: (patch) => {
      currentConfig = { ...currentConfig, ...patch };
    },
  };

  const utility = {
    cache,
    config: configApi,
    setEnvironment(name: string): void {
      const environments = currentConfig.environments;
      if (!environments || environments[name] === undefined) {
        throw new ConfigurationError(
          `Cannot set environment "${name}": not present in the environments map.`,
        );
      }
      currentConfig = { ...currentConfig, activeEnvironment: name };
      // Switching environments invalidates the entire cache (spec E6).
      cacheStore.clear();
    },
    getSchema(): SchemaAST | undefined {
      return schemaCache.get();
    },
    on(event: string, listener: ClientEventListener): void {
      const set = listeners.get(event) ?? new Set<ClientEventListener>();
      set.add(listener);
      listeners.set(event, set);
    },
    off(event: string, listener: ClientEventListener): void {
      listeners.get(event)?.delete(listener);
    },
  };

  return new Proxy(client as ApiClient, {
    get(target, prop, receiver): unknown {
      if (typeof prop === 'string' && RESERVED_CLIENT_MEMBERS.has(prop)) {
        return utility[prop as keyof typeof utility];
      }
      return Reflect.get(target, prop, receiver);
    },
    set(): boolean {
      return false;
    },
  });
}
