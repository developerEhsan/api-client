/**
 * Public API surface for @developerehsan/api-client (browser / node default bundle).
 * Explicit exports only — nothing else is part of the supported contract.
 */

// --- Factory ---
export { createClient } from './factory/createClient';
export type {
  ApiClient,
  ClientCache,
  ClientConfigApi,
  ClientEventListener,
} from './factory/createClient';
export { defineModule } from './factory/createModule';
export {
  createTypedClient,
  createModuleDefiner,
  buildModulesFromDescriptors,
} from './factory/createTypedClient';
export type {
  TypedApiClient,
  TypedModules,
  TypedModulesConfig,
  TypedModuleContext,
  TypedRequest,
  ConfigModuleDefinition,
  ConfigModuleMethod,
  ModuleMethodHints,
  ModuleDefiner,
  GeneratedModuleMap,
  GeneratedMethodDescriptor,
} from './factory/createTypedClient';

// --- Errors (typed, throwable) ---
export { ApiError } from './errors/ApiError';
export { NetworkError } from './errors/NetworkError';
export { TimeoutError } from './errors/TimeoutError';
export { AuthError } from './errors/AuthError';
export { SchemaError, SchemaParseError } from './errors/SchemaError';
export { ConfigurationError } from './errors/ConfigurationError';
export { classifyError, extractServerError } from './errors/errorClassifier';

// --- HTTP adapters ---
export type { HttpAdapter, AdapterFactory } from './http/adapters/adapterInterface';
export { createFetchAdapter } from './http/adapters/fetchAdapter';
export { createAxiosAdapter } from './http/adapters/axiosAdapter';

// --- Utilities (advanced/standalone use) ---
export { createDeduplicator, computeDedupeKey } from './utilities/deduplicator';
export type { Deduplicator } from './utilities/deduplicator';
export { createCache, computeCacheKey, isFresh } from './utilities/cache';
export type { CacheStore } from './utilities/cache';
export { createQueue } from './utilities/queue';
export type { ConcurrencyQueue } from './utilities/queue';
export {
  createCancellationManager,
  isAbortError,
  linkSignals,
} from './utilities/cancellation';
export type { CancellationManager } from './utilities/cancellation';
export { withRetry, computeBackoff, parseRetryAfter } from './utilities/retry';
export type { ResolvedRetryOptions } from './utilities/retry';

// --- Auth ---
export { createAuthManager } from './auth/authManager';
export type { AuthManager } from './auth/authManager';
export type {
  BearerAuthConfig,
  CookieAuthConfig,
  ApiKeyAuthConfig,
  OAuth2AuthConfig,
  NoAuthConfig,
  OAuth2Tokens,
  AuthStrategyName,
  AuthContribution,
} from './types/auth.types';

// --- Runtime schema (validation & drift) ---
export { createSchemaCache } from './runtime/schemaCache';
export type { SchemaCache } from './runtime/schemaCache';
export { createSchemaLoader } from './runtime/schemaLoader';
export type { SchemaLoader } from './runtime/schemaLoader';
export {
  diffSchemas,
  hashSchema,
  hasDrift,
  handleDrift,
} from './runtime/driftDetector';
export type { DriftPolicy } from './runtime/driftDetector';
export { validateValue, validateResponseBody } from './codegen/schemaValidator';
export type { ValidationResult } from './codegen/schemaValidator';

// --- Tenancy ---
export { resolveTenantId } from './tenancy/tenantManager';
export {
  runWithTenant,
  getTenantFromContext,
  hasTenantContext,
} from './tenancy/tenantContext';

// --- Environment ---
export { detectEnvironment } from './environment/detect';
export {
  readServerHeader,
  readServerCookie,
  serverTenantResolver,
  serverTokenFromCookie,
} from './environment/serverContext';

// --- Types ---
export type {
  GlobalConfig,
  ModuleConfig,
  PerCallConfig,
  ResolvedRequestConfig,
  RetryConfig,
  HttpConfig,
  CancellationConfig,
  TenancyConfig,
  ValidationConfig,
  OpenApiConfig,
  LifecycleHooks,
} from './types/config.types';
export type {
  ApiRequest,
  ApiResponse,
  AdapterResponse,
  HttpMethod,
  ResponseType,
  ServerErrorBody,
} from './types/http.types';
export type { AuthConfig } from './types/auth.types';
export type { CacheConfig, CacheEntry, CacheStrategy } from './types/cache.types';
export type {
  ModuleDefinition,
  ModuleContext,
  ModuleMethods,
} from './types/module.types';
export type { SchemaAST, SchemaDiff } from './types/openapi.types';
export type {
  Environment,
  DetectedEnvironment,
  PlatformCapabilities,
} from './types/environment.types';
