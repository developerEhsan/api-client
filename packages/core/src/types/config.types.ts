/**
 * Configuration interfaces: GlobalConfig, ModuleConfig, PerCallConfig.
 *
 * Merge precedence (highest first):
 *   per-call  ->  module  ->  global  ->  library defaults
 * All merges are deep merges.
 *
 * @see {@link https://github.com/developerEhsan/api-client/blob/master/docs/configuration.md}
 */

import type { ApiError } from '../errors/ApiError';
import type { ComposedHooks } from '../factory/composeHooks';
import type { AuthConfig } from './auth.types';
import type { CacheConfig } from './cache.types';
import type { ApiRequest, ApiResponse, ResponseType } from './http.types';
import type { ModuleDefinition } from './module.types';
import type { SchemaAST, SchemaDiff } from './openapi.types';

/**
 * Automatic retry policy for failed requests. Controls how many times and how
 * fast a request is retried after a retryable failure.
 *
 * @example
 * ```ts
 * http: {
 *   retry: {
 *     attempts: 5,            // one initial try + four retries
 *     backoff: 'exponential', // 500ms, 1s, 2s, 4s ...
 *     baseDelay: 500,
 *     maxDelay: 10_000,       // cap any single delay at 10s
 *     jitter: true,           // spread retries to avoid a thundering herd
 *   },
 * }
 * ```
 */
export interface RetryConfig {
  /**
   * Total number of attempts (including the first). `3` means one initial try
   * plus two retries.
   * @default 3
   * @example `retry: { attempts: 5 }`
   */
  attempts?: number;
  /**
   * Delay growth between retries:
   * - `'exponential'` — `baseDelay * 2^n`.
   * - `'linear'` — `baseDelay * n`.
   * - `'fixed'` — always `baseDelay`.
   * @default 'exponential'
   * @example `retry: { backoff: 'fixed' }`
   */
  backoff?: 'exponential' | 'linear' | 'fixed';
  /**
   * Base delay in milliseconds used by the backoff formula.
   * @default 500
   * @example `retry: { baseDelay: 1000 }`
   */
  baseDelay?: number;
  /**
   * Upper bound in milliseconds applied to each computed delay and to any
   * server `Retry-After` value.
   * @default 30000
   * @example `retry: { maxDelay: 10_000 }`
   */
  maxDelay?: number;
  /**
   * When `true`, applies full-jitter randomization to each delay to avoid a
   * thundering-herd of synchronized retries.
   * @default true
   * @example `retry: { jitter: false }`
   */
  jitter?: boolean;
  /**
   * Predicate deciding whether a given error should be retried.
   * @default optional, unset means retry 5xx/429/network errors via `ApiError.isRetryable`
   * @example
   * ```ts
   * // Only retry rate-limits and gateway errors, never other 5xx.
   * retryOn: (error) => error.status === 429 || error.status === 502
   * ```
   */
  retryOn?: (error: ApiError) => boolean;
  /**
   * Callback fired before each retry sleep.
   * @default optional, unset means no callback
   * @example `retry: { onRetry: (attempt, error) => console.warn('retry', attempt, error) }`
   */
  onRetry?: (attempt: number, error: ApiError) => void;
}

/**
 * Concurrency queue controlling how many requests run at once and in what
 * order queued ones are released.
 *
 * @example
 * ```ts
 * http: {
 *   queue: {
 *     enabled: true,
 *     concurrency: 4,   // at most 4 requests in flight at once
 *     priority: 'fifo', // oldest queued request runs first
 *   },
 * }
 * ```
 */
export interface QueueConfig {
  /**
   * Master switch for the request queue.
   * @default true
   * @example `queue: { enabled: false }`
   */
  enabled?: boolean;
  /**
   * Maximum number of simultaneous in-flight requests.
   * @default 10
   * @example `queue: { concurrency: 4 }`
   */
  concurrency?: number;
  /**
   * Release order of queued requests:
   * - `'fifo'` — oldest queued request runs first.
   * - `'lifo'` — newest queued request runs first.
   * @default 'fifo'
   * @example `queue: { priority: 'lifo' }`
   */
  priority?: 'fifo' | 'lifo';
}

/**
 * Transport-layer configuration: adapter selection, timeouts, headers,
 * retries, dedup, and queueing for every request the client sends.
 *
 * @example
 * ```ts
 * http: {
 *   timeout: 8000,                          // 8s per attempt
 *   headers: { 'X-Client': 'petstore-web' },
 *   retry: { attempts: 5 },                 // see RetryConfig
 *   queue: { concurrency: 4 },              // see QueueConfig
 *   deduplication: true,                    // coalesce identical GETs
 * }
 * ```
 */
export interface HttpConfig {
  /**
   * HTTP backend to use, or a custom {@link HttpAdapterLike}:
   * - `'axios'` — use axios (Node only, must be installed).
   * - `'fetch'` — use the global `fetch`.
   * @default auto-detected — 'axios' on Node when axios is installed, else
   * 'fetch'; edge/browser always 'fetch'; edge downgrades a requested 'axios'
   * to 'fetch' with a warning
   * @example `http: { adapter: 'fetch' }`
   */
  adapter?: 'axios' | 'fetch' | HttpAdapterLike;
  /**
   * Per-attempt timeout in milliseconds, enforced via `AbortController`
   * (fetch has no native timeout).
   * @default 10000
   * @example `http: { timeout: 8000 }`
   */
  timeout?: number;
  /**
   * Headers merged into every request.
   * @default optional, unset means no extra headers
   * @example `http: { headers: { 'X-Client': 'petstore-web' } }`
   */
  headers?: Record<string, string>;
  /**
   * Retry policy (see {@link RetryConfig}).
   * @default optional, unset means the RetryConfig defaults apply
   * @example `http: { retry: { attempts: 5 } }`
   */
  retry?: RetryConfig;
  /**
   * When `true`, in-flight identical requests are coalesced into a single
   * network call.
   * @default true
   * @example `http: { deduplication: false }`
   */
  deduplication?: boolean;
  /**
   * HTTP methods eligible for deduplication.
   * @default ['GET']
   * @example `http: { dedupeMethod: ['GET', 'HEAD'] }`
   */
  dedupeMethod?: string[];
  /**
   * Concurrency queue (see {@link QueueConfig}).
   * @default optional, unset means the QueueConfig defaults apply
   * @example `http: { queue: { concurrency: 4 } }`
   */
  queue?: QueueConfig;
  /**
   * When set, responses larger than this many bytes are aborted.
   * @default optional, unset means unlimited
   * @example `http: { maxResponseSize: 10_000_000 }`
   */
  maxResponseSize?: number;
}

/** Minimal structural type so config files can reference a custom adapter. */
export interface HttpAdapterLike {
  /** Sends one request and resolves with the raw response shape. */
  send(request: ApiRequest): Promise<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    data: unknown;
  }>;
}

/**
 * Response-body validation settings, comparing runtime responses against the
 * OpenAPI schema. Part of {@link OpenApiConfig}.
 *
 * @example
 * ```ts
 * openapi: {
 *   validation: {
 *     enabled: true,
 *     mode: 'strict',                       // throw a SchemaError on mismatch
 *     onDriftDetected: (diff) => console.warn('spec drift', diff),
 *   },
 * }
 * ```
 */
export interface ValidationConfig {
  /**
   * Master switch for response-body validation.
   * @default false
   * @example `validation: { enabled: true }`
   */
  enabled?: boolean;
  /**
   * How validation failures / schema drift are surfaced:
   * - `'strict'` — throw a `SchemaError`.
   * - `'loose'` — only emit a warning.
   * @default 'loose'
   * @example `validation: { mode: 'strict' }`
   */
  mode?: 'strict' | 'loose';
  /**
   * Callback fired when the runtime schema differs from the generated one.
   * @default optional, unset means no drift callback
   * @example `validation: { onDriftDetected: (diff) => console.warn('spec drift', diff) }`
   */
  onDriftDetected?: (diff: SchemaDiff) => void;
}

/**
 * OpenAPI wiring: where the spec lives, whether it is loaded at runtime, and
 * the response-validation policy derived from it. Required on
 * {@link GlobalConfig}.
 *
 * @example
 * ```ts
 * openapi: {
 *   schemaPath: './openapi/petstore.json',                 // consumed by codegen
 *   runtimeURL: 'https://petstore3.swagger.io/api/v3/openapi.json',
 *   mode: 'auto',                                          // runtime since runtimeURL is set
 *   validation: { enabled: true, mode: 'loose' },
 * }
 * ```
 */
export interface OpenApiConfig {
  /**
   * Filesystem path to the OpenAPI JSON, consumed by codegen.
   * @default optional, unset means no on-disk spec
   * @example `openapi: { schemaPath: './openapi/petstore.json' }`
   */
  schemaPath?: string;
  /**
   * URL fetched in the background at runtime to power response validation and
   * drift detection; not bundled into the client.
   * @default optional, unset means no runtime fetch
   * @example `openapi: { runtimeURL: 'https://petstore3.swagger.io/api/v3/openapi.json' }`
   */
  runtimeURL?: string;
  /**
   * Spec loading mode:
   * - `'codegen'` — types generated at build only, no runtime fetch.
   * - `'runtime'` — fetch the spec at runtime.
   * - `'auto'` — runtime if `runtimeURL` is present, else codegen.
   * @default effectively 'auto' — runtime loading happens whenever mode is not
   * 'codegen' and `runtimeURL` is set
   * @example `openapi: { mode: 'codegen' }`
   */
  mode?: 'codegen' | 'runtime' | 'auto';
  /**
   * Response validation policy (see {@link ValidationConfig}).
   * @default optional, unset means the ValidationConfig defaults apply
   * @example `openapi: { validation: { enabled: true } }`
   */
  validation?: ValidationConfig;
}

/**
 * Multi-tenancy configuration: how the tenant id is resolved and which header
 * carries it.
 *
 * @example
 * ```ts
 * tenancy: {
 *   headerName: 'X-Tenant-ID',
 *   getTenantId: () => localStorage.getItem('tenant') ?? 'public',
 * }
 * ```
 */
export interface TenancyConfig {
  /**
   * Header the resolved tenant id is sent under.
   * @default 'X-Tenant-ID'
   * @example `tenancy: { headerName: 'X-Org-ID' }`
   */
  headerName?: string;
  /**
   * Resolver for the tenant id (sync or async). Precedence: per-call
   * `tenantId` > this resolver > AsyncLocalStorage ambient tenant. Throwing
   * raises a `ConfigurationError`.
   * @default optional, unset means fall back to the ambient tenant
   * @example
   * ```ts
   * // Async resolution, e.g. reading the active org from a store.
   * getTenantId: async () => (await getSession()).orgId
   * ```
   */
  getTenantId?: () => string | Promise<string>;
}

/**
 * Request-cancellation behavior, primarily for search-as-you-type and
 * framework unmount scenarios.
 *
 * @example
 * ```ts
 * cancellation: {
 *   dedupeWindow: 300,     // a newer identical request within 300ms cancels the prior one
 *   cancelOnUnmount: true, // let framework integrations abort on unmount
 * }
 * ```
 */
export interface CancellationConfig {
  /**
   * Window in milliseconds within which a newer identical request auto-cancels
   * the previous in-flight one. `0` disables this.
   * @default 0
   * @example `cancellation: { dedupeWindow: 300 }`
   */
  dedupeWindow?: number;
  /**
   * Hint consumed by framework integrations to cancel on unmount; core does
   * not enforce it.
   * @default optional, unset means integrations decide
   * @example `cancellation: { cancelOnUnmount: true }`
   */
  cancelOnUnmount?: boolean;
}

/**
 * Development-time conveniences: logging, response validation, and schema
 * polling. Intended to be enabled in dev, off in production.
 *
 * @example
 * ```ts
 * dev: {
 *   logging: 'verbose',            // full request/response detail in the console
 *   validateResponses: true,       // check bodies against the spec while developing
 *   schemaRefreshInterval: 30_000, // re-fetch the runtime schema every 30s
 * }
 * ```
 */
export interface DevConfig {
  /**
   * Console logging level:
   * - `false` — no logging.
   * - `true` — concise per-request/response logs.
   * - `'verbose'` — full request/response detail.
   * @default false
   * @example `dev: { logging: 'verbose' }`
   */
  logging?: boolean | 'verbose';
  /**
   * Convenience toggle enabling response validation during development.
   * @default false
   * @example `dev: { validateResponses: true }`
   */
  validateResponses?: boolean;
  /**
   * Polling interval in milliseconds to re-fetch the runtime schema and run
   * drift detection.
   * @default optional, unset means no polling
   * @example `dev: { schemaRefreshInterval: 30_000 }`
   */
  schemaRefreshInterval?: number;
}

/**
 * Global lifecycle hooks fired around the request pipeline. All optional; use
 * for logging, metrics, transformation, or observability.
 *
 * @example
 * ```ts
 * hooks: {
 *   onRequest: (req) => ({ ...req, headers: { ...req.headers, 'X-Trace': crypto.randomUUID() } }),
 *   onError: (err) => reportToSentry(err),
 *   onCacheHit: (key) => console.debug('cache hit', key),
 * }
 * ```
 */
export interface LifecycleHooks {
  /**
   * Inspect/transform the outgoing request before it is sent. Return the
   * modified request, or `void`/`undefined` to pass it through unchanged. When
   * set at multiple layers the hooks chain (each receives the previous output).
   * May be async.
   * @default optional, unset means no hook
   * @example `hooks: { onRequest: (req) => ({ ...req, headers: { ...req.headers, 'X-Trace': '1' } }) }`
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: `void` intentionally lets a hook omit a return to pass the request through unchanged.
  onRequest?: (request: ApiRequest) => ApiRequest | void | Promise<ApiRequest | void>;
  /**
   * Inspect/transform a successful response before it is returned. Return the
   * modified response, or `void`/`undefined` to pass it through unchanged.
   * Chains across layers like {@link LifecycleHooks.onRequest}. May be async.
   * @default optional, unset means no hook
   * @example `hooks: { onResponse: (res) => res } // pass-through`
   */
  onResponse?: <T>(
    response: ApiResponse<T>,
    // biome-ignore lint/suspicious/noConfusingVoidType: `void` intentionally lets a hook omit a return to pass the response through unchanged.
  ) => ApiResponse<T> | void | Promise<ApiResponse<T> | void>;
  /**
   * Observe every thrown error; cannot suppress it. May be async.
   * @default optional, unset means no hook
   * @example `hooks: { onError: (err) => reportToSentry(err) }`
   */
  onError?: (error: ApiError) => void | Promise<void>;
  /**
   * Fires on each retry attempt.
   * @default optional, unset means no hook
   * @example `hooks: { onRetry: (attempt, error) => console.warn('retry', attempt, error) }`
   */
  onRetry?: (attempt: number, error: ApiError) => void;
  /**
   * Fires when a request is served from cache.
   * @default optional, unset means no hook
   * @example `hooks: { onCacheHit: (key) => console.debug('cache hit', key) }`
   */
  onCacheHit?: (key: string, entry: import('./cache.types').CacheEntry) => void;
  /**
   * Fires when a cache lookup misses.
   * @default optional, unset means no hook
   * @example `hooks: { onCacheMiss: (key) => console.debug('cache miss', key) }`
   */
  onCacheMiss?: (key: string) => void;
  /**
   * Fires when a request resolves successfully (from network or cache), just
   * before the response is returned to the caller. Observational; cannot alter
   * the response (use `onResponse` to transform). May be async.
   * @default optional, unset means no hook
   * @example `hooks: { onSuccess: (res) => console.debug('ok', res.status) }`
   */
  onSuccess?: <T>(response: ApiResponse<T>) => void | Promise<void>;
  /**
   * Fires exactly once when a request settles, whether it succeeded, failed, or
   * was cancelled — the `finally` of the request lifecycle. Exactly one of
   * `response`/`error` is set on success/failure; both are `undefined` on
   * cancellation. May be async.
   * @default optional, unset means no hook
   * @example `hooks: { onSettled: (res, err) => console.debug('settled', res, err) }`
   */
  onSettled?: <T>(
    response: ApiResponse<T> | undefined,
    error: ApiError | undefined,
  ) => void | Promise<void>;
}

/**
 * Module registry. `config.modules` is the final source of truth and overrides
 * generated modules per-method. Extra keys are module definitions or booleans.
 */
export interface ModulesConfig {
  /**
   * When `true`, generated auto-modules are built from the spec.
   * @default governed by createClient
   * @example `modules: { auto: false }`
   */
  auto?: boolean;
  /**
   * A module definition, or `true`/`false` to enable/disable a named module.
   */
  [moduleName: string]: ModuleDefinition | boolean | undefined;
}

/**
 * Top-level client configuration passed to `createClient`. Establishes the
 * base layer that module and per-call config are merged over.
 *
 * @example
 * ```ts
 * const config: GlobalConfig = {
 *   baseURL: 'https://petstore3.swagger.io/api/v3',
 *   openapi: { runtimeURL: 'https://petstore3.swagger.io/api/v3/openapi.json' },
 *   http: { timeout: 8000, retry: { attempts: 3 } },
 *   auth: { strategy: 'bearer', getToken: () => localStorage.getItem('token') },
 *   cache: { ttl: 60_000, strategy: 'stale-while-revalidate' },
 * }
 * ```
 */
export interface GlobalConfig {
  /**
   * Root URL all module/spec paths are appended to.
   * @default required unless `activeEnvironment` resolves one
   * @example `{ baseURL: 'https://petstore3.swagger.io/api/v3' }`
   */
  baseURL: string;
  /**
   * Named `baseURL` map selectable via `activeEnvironment`.
   * @default optional, unset means only `baseURL` is used
   * @example `{ environments: { staging: 'https://staging.example.com', prod: 'https://api.example.com' } }`
   */
  environments?: Record<string, string>;
  /**
   * Key into `environments` whose URL overrides `baseURL`; errors if the key
   * is missing.
   * @default optional, unset means `baseURL` is used as-is
   * @example `{ activeEnvironment: 'staging' }`
   */
  activeEnvironment?: string;

  /**
   * OpenAPI wiring and validation policy (see {@link OpenApiConfig}).
   * @default no default — required
   * @example `{ openapi: { runtimeURL: 'https://petstore3.swagger.io/api/v3/openapi.json' } }`
   */
  openapi: OpenApiConfig;

  /**
   * Transport configuration (see {@link HttpConfig}).
   * @default optional, unset means the HttpConfig defaults apply
   * @example `{ http: { timeout: 8000 } }`
   */
  http?: HttpConfig;
  /**
   * Authentication strategy (see {@link AuthConfig}).
   * @default optional, unset means no authentication ('none')
   * @example `{ auth: { strategy: 'bearer', getToken: () => localStorage.getItem('token') } }`
   */
  auth?: AuthConfig;
  /**
   * Response cache configuration (see {@link CacheConfig}).
   * @default optional, unset means the CacheConfig defaults apply
   * @example `{ cache: { ttl: 60_000 } }`
   */
  cache?: CacheConfig;
  /**
   * Cancellation behavior (see {@link CancellationConfig}).
   * @default optional, unset means the CancellationConfig defaults apply
   * @example `{ cancellation: { dedupeWindow: 300 } }`
   */
  cancellation?: CancellationConfig;
  /**
   * Multi-tenancy configuration (see {@link TenancyConfig}).
   * @default optional, unset means no tenant header
   * @example `{ tenancy: { headerName: 'X-Tenant-ID' } }`
   */
  tenancy?: TenancyConfig;
  /**
   * Module registry (see {@link ModulesConfig}).
   * @default optional, unset means generated modules only
   * @example `{ modules: { auto: true } }`
   */
  modules?: ModulesConfig;
  /**
   * Development-time toggles (see {@link DevConfig}).
   * @default optional, unset means the DevConfig defaults apply
   * @example `{ dev: { logging: true } }`
   */
  dev?: DevConfig;
  /**
   * Global lifecycle hooks (see {@link LifecycleHooks}).
   * @default optional, unset means no hooks
   * @example `{ hooks: { onError: (err) => reportToSentry(err) } }`
   */
  hooks?: LifecycleHooks;

  /**
   * When `true`, module methods return a discriminated
   * `{ success: true, data } | { success: false, error }` union instead of
   * throwing (aborts still throw).
   * @default false
   * @example `{ safeMode: true }`
   */
  safeMode?: boolean;
}

/**
 * Per-module overrides that replace the corresponding global values for one
 * module only. All fields optional; anything omitted inherits the global layer.
 *
 * @example
 * ```ts
 * // Overrides for the `pet` module only.
 * const petModuleConfig: ModuleConfig = {
 *   timeout: 15_000,                           // slower uploads get more time
 *   headers: { 'X-Module': 'pet' },
 *   cache: { ttl: 5_000 },                     // pet listings go stale quickly
 *   retry: { attempts: 2 },
 * }
 * ```
 */
export interface ModuleConfig {
  /**
   * Overrides the base URL for this module.
   * @default optional, unset means inherit the global `baseURL`
   * @example `{ baseURL: 'https://uploads.example.com' }`
   */
  baseURL?: string;
  /**
   * Overrides the per-attempt timeout (ms) for this module.
   * @default optional, unset means inherit the global timeout
   * @example `{ timeout: 15_000 }`
   */
  timeout?: number;
  /**
   * Headers merged over global headers for this module.
   * @default optional, unset means inherit the global headers
   * @example `{ headers: { 'X-Module': 'pet' } }`
   */
  headers?: Record<string, string>;
  /**
   * Overrides the auth strategy for this module.
   * @default optional, unset means inherit the global auth
   * @example `{ auth: { strategy: 'apiKey', getKey: () => process.env.MODULE_KEY } }`
   */
  auth?: Partial<AuthConfig>;
  /**
   * Overrides cache settings for this module.
   * @default optional, unset means inherit the global cache
   * @example `{ cache: { ttl: 5_000 } }`
   */
  cache?: Partial<CacheConfig>;
  /**
   * Overrides retry settings for this module.
   * @default optional, unset means inherit the global retry
   * @example `{ retry: { attempts: 2 } }`
   */
  retry?: Partial<RetryConfig>;
  /**
   * Overrides tenancy settings for this module.
   * @default optional, unset means inherit the global tenancy
   * @example `{ tenancy: { headerName: 'X-Module-Tenant' } }`
   */
  tenancy?: Partial<TenancyConfig>;
  /**
   * Overrides validation settings for this module.
   * @default optional, unset means inherit the global validation
   * @example `{ validation: { enabled: true } }`
   */
  validation?: Partial<ValidationConfig>;
  /**
   * Lifecycle hooks for this module. These COMPOSE with the global hooks — both
   * fire (global first, then module), and transforming hooks
   * (`onRequest`/`onResponse`) chain their return values. They do not replace
   * the global hooks. See {@link LifecycleHooks}.
   * @default optional, unset means only global (and per-call) hooks run
   * @example `{ hooks: { onError: (err) => console.error('[pet]', err) } }`
   */
  hooks?: LifecycleHooks;
}

/**
 * Highest-precedence overrides supplied on a single method call. Merged over
 * both module and global layers for that one request.
 *
 * @example
 * ```ts
 * // client.pet.getPetById({ petId: 1 }, perCall)
 * const perCall: PerCallConfig = {
 *   signal: controller.signal,     // cancel this call externally
 *   cache: { bust: true },         // force a fresh fetch, overwrite the entry
 *   timeout: 3000,                 // tighter deadline for this one request
 *   tenantId: 'acme',
 * }
 * ```
 */
export interface PerCallConfig {
  /**
   * `AbortSignal` used to cancel this call.
   * @default optional, unset means the call is not externally cancelable
   * @example `{ signal: controller.signal }`
   */
  signal?: AbortSignal;
  /**
   * Headers merged over global/module headers for this call.
   * @default optional, unset means inherit global/module headers
   * @example `{ headers: { 'X-Request-Id': crypto.randomUUID() } }`
   */
  headers?: Record<string, string>;
  /**
   * Highest-precedence tenant id for this call.
   * @default optional, unset means the tenancy resolver/ambient tenant applies
   * @example `{ tenantId: 'acme' }`
   */
  tenantId?: string;
  /**
   * Cache overrides for this call. `bust` forces a fresh fetch and overwrites
   * the cached entry.
   * @default optional, unset means inherit global/module cache
   * @example `{ cache: { bust: true } }`
   */
  cache?: {
    enabled?: boolean;
    ttl?: number;
    bust?: boolean;
    /**
     * Tags this specific call's cache entry is filed under, in addition to
     * any tags the method descriptor declares (union, not override). Tags
     * are exact-match labels used only for invalidation, never for gating
     * read access — see `invalidateTags`.
     * @default optional, unset means only descriptor-level tags (if any) apply
     * @example `{ cache: { tags: ['pet:1'] } }`
     */
    tags?: string[];
    /**
     * Tags to invalidate, across every auth scope in this process, after
     * this specific call succeeds. Unions with descriptor-level
     * `invalidatesTags`.
     * @default optional, unset means only descriptor-level invalidation (if any) applies
     * @example `{ cache: { invalidatesTags: ['pet:1'] } }`
     */
    invalidatesTags?: string[];
    /**
     * Extra cache-key dimensions for this specific call, unioned with any
     * the method descriptor computes (spec 10). See `CacheConfig.cacheKeyParts`.
     * @default optional, unset means only descriptor-level parts (if any) apply
     * @example `{ cache: { cacheKeyParts: { locale: 'en-US' } } }`
     */
    cacheKeyParts?: Record<string, string>;
  };
  /**
   * Retry override for this call (attempt count only).
   * @default optional, unset means inherit global/module retry
   * @example `{ retry: { attempts: 1 } }`
   */
  retry?: { attempts?: number };
  /**
   * Highest-precedence per-attempt timeout in milliseconds.
   * @default falls back to module/global/10000
   * @example `{ timeout: 3000 }`
   */
  timeout?: number;
  /**
   * When `true`, bypasses the auth interceptor for this call.
   * @default false
   * @example `{ skipAuth: true }`
   */
  skipAuth?: boolean;
  /**
   * When `true`, bypasses in-flight deduplication for this call.
   * @default false
   * @example `{ skipDedup: true }`
   */
  skipDedup?: boolean;
  /**
   * How the response body is parsed.
   * @default 'json'
   * @example `{ responseType: 'blob' }`
   */
  responseType?: ResponseType;
  /**
   * When `false`, bypasses the concurrency queue for this call (it runs
   * immediately regardless of the configured concurrency limit). When omitted,
   * the global queue setting applies.
   * @default inherit the global `http.queue.enabled`
   * @example `{ queue: false }`
   */
  queue?: boolean;
  /**
   * Lifecycle hooks for just this call. These COMPOSE with the global and
   * module hooks (all fire, per-call last; transforming hooks chain). See
   * {@link LifecycleHooks}.
   * @default optional, unset means only global/module hooks run
   * @example `{ hooks: { onSuccess: (res) => console.log('done', res.status) } }`
   */
  hooks?: LifecycleHooks;
}

/**
 * Fully-resolved, defaults-applied config for a single request. Produced by
 * `mergeModuleConfig` from global + module + per-call layers.
 */
export interface ResolvedRequestConfig {
  baseURL: string;
  timeout: number;
  headers: Record<string, string>;
  auth: AuthConfig;
  cache: Required<Pick<CacheConfig, 'enabled' | 'ttl' | 'strategy' | 'maxSize'>> &
    CacheConfig & { bust?: boolean; tags?: string[]; invalidatesTags?: string[] };
  retry: Required<Pick<RetryConfig, 'attempts' | 'backoff' | 'baseDelay' | 'maxDelay' | 'jitter'>> &
    RetryConfig;
  tenancy: TenancyConfig;
  validation: ValidationConfig;
  signal?: AbortSignal;
  tenantId?: string;
  skipAuth: boolean;
  skipDedup: boolean;
  responseType: ResponseType;
  safeMode: boolean;
  /** Composed global+module+per-call lifecycle hooks (see {@link ComposedHooks}). */
  hooks: ComposedHooks;
  /** Per-call queue override; `undefined` means inherit the global setting. */
  queue?: boolean;
}

/**
 * A JSON-safe, secret-redacted view of the effective config a call would run
 * with, produced by `client.config.resolve(module?, perCall?)`. Function-valued
 * fields (auth token getters, tenancy resolvers, retry predicates, hooks) are
 * never included — auth is reduced to its `strategy`, and hooks to a
 * name -> registered? map — so the snapshot can be safely logged. Purely for
 * debugging "why didn't my override apply".
 */
export interface ResolvedConfigSnapshot {
  baseURL: string;
  timeout: number;
  headers: Record<string, string>;
  auth: { strategy: AuthConfig['strategy'] };
  cache: {
    enabled?: boolean;
    ttl?: number;
    strategy?: CacheConfig['strategy'];
    maxSize?: number;
    bust?: boolean;
  };
  retry: {
    attempts: number;
    backoff: string;
    baseDelay: number;
    maxDelay: number;
    jitter: boolean;
  };
  tenancy: { headerName?: string };
  validation: ValidationConfig;
  skipAuth: boolean;
  skipDedup: boolean;
  responseType: ResponseType;
  safeMode: boolean;
  queue?: boolean;
  /** Which lifecycle hooks are registered at any layer (global/module/per-call). */
  hooks: Record<keyof LifecycleHooks, boolean>;
}

export type { SchemaAST };
