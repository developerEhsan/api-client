/**
 * Configuration interfaces: GlobalConfig, ModuleConfig, PerCallConfig.
 *
 * Merge precedence (highest first):
 *   per-call  ->  module  ->  global  ->  library defaults
 * All merges are deep merges.
 */

import type { ApiError } from '../errors/ApiError';
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
   */
  attempts?: number;
  /**
   * Delay growth between retries:
   * - `'exponential'` — `baseDelay * 2^n`.
   * - `'linear'` — `baseDelay * n`.
   * - `'fixed'` — always `baseDelay`.
   * @default 'exponential'
   */
  backoff?: 'exponential' | 'linear' | 'fixed';
  /**
   * Base delay in milliseconds used by the backoff formula.
   * @default 500
   */
  baseDelay?: number;
  /**
   * Upper bound in milliseconds applied to each computed delay and to any
   * server `Retry-After` value.
   * @default 30000
   */
  maxDelay?: number;
  /**
   * When `true`, applies full-jitter randomization to each delay to avoid a
   * thundering-herd of synchronized retries.
   * @default true
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
   */
  enabled?: boolean;
  /**
   * Maximum number of simultaneous in-flight requests.
   * @default 10
   */
  concurrency?: number;
  /**
   * Release order of queued requests:
   * - `'fifo'` — oldest queued request runs first.
   * - `'lifo'` — newest queued request runs first.
   * @default 'fifo'
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
   */
  adapter?: 'axios' | 'fetch' | HttpAdapterLike;
  /**
   * Per-attempt timeout in milliseconds, enforced via `AbortController`
   * (fetch has no native timeout).
   * @default 10000
   */
  timeout?: number;
  /**
   * Headers merged into every request.
   * @default optional, unset means no extra headers
   */
  headers?: Record<string, string>;
  /**
   * Retry policy (see {@link RetryConfig}).
   * @default optional, unset means the RetryConfig defaults apply
   */
  retry?: RetryConfig;
  /**
   * When `true`, in-flight identical requests are coalesced into a single
   * network call.
   * @default true
   */
  deduplication?: boolean;
  /**
   * HTTP methods eligible for deduplication.
   * @default ['GET']
   */
  dedupeMethod?: string[];
  /**
   * Concurrency queue (see {@link QueueConfig}).
   * @default optional, unset means the QueueConfig defaults apply
   */
  queue?: QueueConfig;
  /**
   * When set, responses larger than this many bytes are aborted.
   * @default optional, unset means unlimited
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
   */
  enabled?: boolean;
  /**
   * How validation failures / schema drift are surfaced:
   * - `'strict'` — throw a `SchemaError`.
   * - `'loose'` — only emit a warning.
   * @default 'loose'
   */
  mode?: 'strict' | 'loose';
  /**
   * Callback fired when the runtime schema differs from the generated one.
   * @default optional, unset means no drift callback
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
   */
  schemaPath?: string;
  /**
   * URL fetched in the background at runtime to power response validation and
   * drift detection; not bundled into the client.
   * @default optional, unset means no runtime fetch
   */
  runtimeURL?: string;
  /**
   * Spec loading mode:
   * - `'codegen'` — types generated at build only, no runtime fetch.
   * - `'runtime'` — fetch the spec at runtime.
   * - `'auto'` — runtime if `runtimeURL` is present, else codegen.
   * @default effectively 'auto' — runtime loading happens whenever mode is not
   * 'codegen' and `runtimeURL` is set
   */
  mode?: 'codegen' | 'runtime' | 'auto';
  /**
   * Response validation policy (see {@link ValidationConfig}).
   * @default optional, unset means the ValidationConfig defaults apply
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
   */
  dedupeWindow?: number;
  /**
   * Hint consumed by framework integrations to cancel on unmount; core does
   * not enforce it.
   * @default optional, unset means integrations decide
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
   */
  logging?: boolean | 'verbose';
  /**
   * Convenience toggle enabling response validation during development.
   * @default false
   */
  validateResponses?: boolean;
  /**
   * Polling interval in milliseconds to re-fetch the runtime schema and run
   * drift detection.
   * @default optional, unset means no polling
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
   * Inspect/transform the outgoing request before it is sent; return the
   * (possibly modified) request. May be async.
   * @default optional, unset means no hook
   */
  onRequest?: (request: ApiRequest) => ApiRequest | Promise<ApiRequest>;
  /**
   * Inspect/transform a successful response before it is returned. May be
   * async.
   * @default optional, unset means no hook
   */
  onResponse?: <T>(response: ApiResponse<T>) => ApiResponse<T> | Promise<ApiResponse<T>>;
  /**
   * Observe every thrown error; cannot suppress it. May be async.
   * @default optional, unset means no hook
   */
  onError?: (error: ApiError) => void | Promise<void>;
  /**
   * Fires on each retry attempt.
   * @default optional, unset means no hook
   */
  onRetry?: (attempt: number, error: ApiError) => void;
  /**
   * Fires when a request is served from cache.
   * @default optional, unset means no hook
   */
  onCacheHit?: (key: string, entry: import('./cache.types').CacheEntry) => void;
  /**
   * Fires when a cache lookup misses.
   * @default optional, unset means no hook
   */
  onCacheMiss?: (key: string) => void;
}

/**
 * Module registry. `config.modules` is the final source of truth and overrides
 * generated modules per-method. Extra keys are module definitions or booleans.
 */
export interface ModulesConfig {
  /**
   * When `true`, generated auto-modules are built from the spec.
   * @default governed by createClient
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
   */
  baseURL: string;
  /**
   * Named `baseURL` map selectable via `activeEnvironment`.
   * @default optional, unset means only `baseURL` is used
   */
  environments?: Record<string, string>;
  /**
   * Key into `environments` whose URL overrides `baseURL`; errors if the key
   * is missing.
   * @default optional, unset means `baseURL` is used as-is
   */
  activeEnvironment?: string;

  /**
   * OpenAPI wiring and validation policy (see {@link OpenApiConfig}).
   * @default no default — required
   */
  openapi: OpenApiConfig;

  /**
   * Transport configuration (see {@link HttpConfig}).
   * @default optional, unset means the HttpConfig defaults apply
   */
  http?: HttpConfig;
  /**
   * Authentication strategy (see {@link AuthConfig}).
   * @default optional, unset means no authentication ('none')
   */
  auth?: AuthConfig;
  /**
   * Response cache configuration (see {@link CacheConfig}).
   * @default optional, unset means the CacheConfig defaults apply
   */
  cache?: CacheConfig;
  /**
   * Cancellation behavior (see {@link CancellationConfig}).
   * @default optional, unset means the CancellationConfig defaults apply
   */
  cancellation?: CancellationConfig;
  /**
   * Multi-tenancy configuration (see {@link TenancyConfig}).
   * @default optional, unset means no tenant header
   */
  tenancy?: TenancyConfig;
  /**
   * Module registry (see {@link ModulesConfig}).
   * @default optional, unset means generated modules only
   */
  modules?: ModulesConfig;
  /**
   * Development-time toggles (see {@link DevConfig}).
   * @default optional, unset means the DevConfig defaults apply
   */
  dev?: DevConfig;
  /**
   * Global lifecycle hooks (see {@link LifecycleHooks}).
   * @default optional, unset means no hooks
   */
  hooks?: LifecycleHooks;

  /**
   * When `true`, module methods return a discriminated
   * `{ success: true, data } | { success: false, error }` union instead of
   * throwing (aborts still throw).
   * @default false
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
   */
  baseURL?: string;
  /**
   * Overrides the per-attempt timeout (ms) for this module.
   * @default optional, unset means inherit the global timeout
   */
  timeout?: number;
  /**
   * Headers merged over global headers for this module.
   * @default optional, unset means inherit the global headers
   */
  headers?: Record<string, string>;
  /**
   * Overrides the auth strategy for this module.
   * @default optional, unset means inherit the global auth
   */
  auth?: Partial<AuthConfig>;
  /**
   * Overrides cache settings for this module.
   * @default optional, unset means inherit the global cache
   */
  cache?: Partial<CacheConfig>;
  /**
   * Overrides retry settings for this module.
   * @default optional, unset means inherit the global retry
   */
  retry?: Partial<RetryConfig>;
  /**
   * Overrides tenancy settings for this module.
   * @default optional, unset means inherit the global tenancy
   */
  tenancy?: Partial<TenancyConfig>;
  /**
   * Overrides validation settings for this module.
   * @default optional, unset means inherit the global validation
   */
  validation?: Partial<ValidationConfig>;
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
   */
  signal?: AbortSignal;
  /**
   * Headers merged over global/module headers for this call.
   * @default optional, unset means inherit global/module headers
   */
  headers?: Record<string, string>;
  /**
   * Highest-precedence tenant id for this call.
   * @default optional, unset means the tenancy resolver/ambient tenant applies
   */
  tenantId?: string;
  /**
   * Cache overrides for this call. `bust` forces a fresh fetch and overwrites
   * the cached entry.
   * @default optional, unset means inherit global/module cache
   */
  cache?: { enabled?: boolean; ttl?: number; bust?: boolean };
  /**
   * Retry override for this call (attempt count only).
   * @default optional, unset means inherit global/module retry
   */
  retry?: { attempts?: number };
  /**
   * Highest-precedence per-attempt timeout in milliseconds.
   * @default falls back to module/global/10000
   */
  timeout?: number;
  /**
   * When `true`, bypasses the auth interceptor for this call.
   * @default false
   */
  skipAuth?: boolean;
  /**
   * When `true`, bypasses in-flight deduplication for this call.
   * @default false
   */
  skipDedup?: boolean;
  /**
   * How the response body is parsed.
   * @default 'json'
   */
  responseType?: ResponseType;
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
    CacheConfig & { bust?: boolean };
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
}

export type { SchemaAST };
