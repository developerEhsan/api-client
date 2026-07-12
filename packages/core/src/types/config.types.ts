/**
 * Configuration interfaces: GlobalConfig, ModuleConfig, PerCallConfig.
 *
 * Merge precedence (highest first):
 *   per-call  ->  module  ->  global  ->  library defaults
 * All merges are deep merges.
 */

import type { AuthConfig } from './auth.types'
import type { CacheConfig } from './cache.types'
import type { ApiRequest, ApiResponse, ResponseType } from './http.types'
import type { SchemaAST, SchemaDiff } from './openapi.types'
import type { ApiError } from '../errors/ApiError'
import type { ModuleDefinition } from './module.types'

export interface RetryConfig {
  attempts?: number
  backoff?: 'exponential' | 'linear' | 'fixed'
  baseDelay?: number
  maxDelay?: number
  jitter?: boolean
  retryOn?: (error: ApiError) => boolean
  onRetry?: (attempt: number, error: ApiError) => void
}

export interface QueueConfig {
  enabled?: boolean
  concurrency?: number
  priority?: 'fifo' | 'lifo'
}

export interface HttpConfig {
  adapter?: 'axios' | 'fetch' | HttpAdapterLike
  timeout?: number
  headers?: Record<string, string>
  retry?: RetryConfig
  deduplication?: boolean
  /** Methods to dedupe. Default: ['GET']. */
  dedupeMethod?: string[]
  queue?: QueueConfig
  /** Abort responses larger than this many bytes, when known. */
  maxResponseSize?: number
}

/** Minimal structural type so config files can reference a custom adapter. */
export interface HttpAdapterLike {
  send(request: ApiRequest): Promise<{
    status: number
    statusText: string
    headers: Record<string, string>
    data: unknown
  }>
}

export interface ValidationConfig {
  enabled?: boolean
  mode?: 'strict' | 'loose'
  onDriftDetected?: (diff: SchemaDiff) => void
}

export interface OpenApiConfig {
  schemaPath?: string
  runtimeURL?: string
  mode?: 'codegen' | 'runtime' | 'auto'
  validation?: ValidationConfig
}

export interface TenancyConfig {
  headerName?: string
  getTenantId?: () => string | Promise<string>
}

export interface CancellationConfig {
  dedupeWindow?: number
  cancelOnUnmount?: boolean
}

export interface DevConfig {
  logging?: boolean | 'verbose'
  validateResponses?: boolean
  schemaRefreshInterval?: number
}

export interface LifecycleHooks {
  onRequest?: (request: ApiRequest) => ApiRequest | Promise<ApiRequest>
  onResponse?: <T>(response: ApiResponse<T>) => ApiResponse<T> | Promise<ApiResponse<T>>
  onError?: (error: ApiError) => void | Promise<void>
  onRetry?: (attempt: number, error: ApiError) => void
  onCacheHit?: (key: string, entry: import('./cache.types').CacheEntry) => void
  onCacheMiss?: (key: string) => void
}

export interface ModulesConfig {
  auto?: boolean
  [moduleName: string]: ModuleDefinition | boolean | undefined
}

export interface GlobalConfig {
  baseURL: string
  environments?: Record<string, string>
  activeEnvironment?: string

  openapi: OpenApiConfig

  http?: HttpConfig
  auth?: AuthConfig
  cache?: CacheConfig
  cancellation?: CancellationConfig
  tenancy?: TenancyConfig
  modules?: ModulesConfig
  dev?: DevConfig
  hooks?: LifecycleHooks

  /**
   * When true, module methods return a discriminated
   * `{ success: true, data } | { success: false, error }` union instead of
   * throwing. Default: false.
   */
  safeMode?: boolean
}

export interface ModuleConfig {
  baseURL?: string
  timeout?: number
  headers?: Record<string, string>
  auth?: Partial<AuthConfig>
  cache?: Partial<CacheConfig>
  retry?: Partial<RetryConfig>
  tenancy?: Partial<TenancyConfig>
  validation?: Partial<ValidationConfig>
}

export interface PerCallConfig {
  signal?: AbortSignal
  headers?: Record<string, string>
  tenantId?: string
  cache?: { enabled?: boolean; ttl?: number; bust?: boolean }
  retry?: { attempts?: number }
  timeout?: number
  skipAuth?: boolean
  skipDedup?: boolean
  responseType?: ResponseType
}

/**
 * Fully-resolved, defaults-applied config for a single request. Produced by
 * `mergeModuleConfig` from global + module + per-call layers.
 */
export interface ResolvedRequestConfig {
  baseURL: string
  timeout: number
  headers: Record<string, string>
  auth: AuthConfig
  cache: Required<Pick<CacheConfig, 'enabled' | 'ttl' | 'strategy' | 'maxSize'>> &
    CacheConfig & { bust?: boolean }
  retry: Required<Pick<RetryConfig, 'attempts' | 'backoff' | 'baseDelay' | 'maxDelay' | 'jitter'>> &
    RetryConfig
  tenancy: TenancyConfig
  validation: ValidationConfig
  signal?: AbortSignal
  tenantId?: string
  skipAuth: boolean
  skipDedup: boolean
  responseType: ResponseType
  safeMode: boolean
}

export type { SchemaAST }
