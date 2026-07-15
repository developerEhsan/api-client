/**
 * Pure config-merge utilities: a generic deep merge and the request-config
 * resolver that layers library defaults -> global -> module -> per-call.
 *
 * No IO. All functions are pure (aside from a `console.warn` diagnostic when
 * both `baseURL` and `activeEnvironment` are supplied).
 */

import { ConfigurationError } from '../errors/ConfigurationError';
import type { AuthConfig } from '../types/auth.types';
import type {
  GlobalConfig,
  ModuleConfig,
  PerCallConfig,
  ResolvedRequestConfig,
} from '../types/config.types';

/** True for plain object literals (not arrays, null, or class instances). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Concatenate two arrays and drop duplicate primitives (object identity kept). */
function mergeArrays(a: readonly unknown[], b: readonly unknown[]): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  for (const item of [...a, ...b]) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * Recursively merge plain objects. Arrays are concatenated then de-duplicated
 * (spec 3.4: "arrays merged not replaced"). Later layers win for scalars;
 * `undefined` values never overwrite an existing value.
 */
export function deepMerge<T>(...layers: Partial<T>[]): T {
  const result: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!isPlainObject(layer)) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      // Guard against prototype pollution from untrusted (e.g. JSON.parse'd)
      // config objects.
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const existing = result[key];
      if (Array.isArray(existing) && Array.isArray(value)) {
        result[key] = mergeArrays(existing, value);
      } else if (isPlainObject(existing) && isPlainObject(value)) {
        result[key] = deepMerge(existing, value);
      } else {
        result[key] = value;
      }
    }
  }
  return result as T;
}

/** Merge header maps across layers; later layers win per-key. */
function mergeHeaders(...maps: (Record<string, string> | undefined)[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [key, value] of Object.entries(map)) {
      if (value !== undefined) out[key] = value;
    }
  }
  return out;
}

/**
 * Resolve the effective `baseURL`, honouring the environments map.
 *
 * - If `activeEnvironment` is set it overrides `baseURL` (E1: warn when both
 *   are supplied; E2: throw {@link ConfigurationError} when the key is absent).
 * - `module.baseURL` overrides the global result when present.
 */
function resolveBaseURL(global: GlobalConfig, moduleBaseURL?: string): string {
  let base = global.baseURL;
  if (global.activeEnvironment !== undefined) {
    const env = global.environments;
    const resolved = env?.[global.activeEnvironment];
    if (resolved === undefined) {
      throw new ConfigurationError(
        `activeEnvironment "${global.activeEnvironment}" is not present in the environments map`,
      );
    }
    if (global.baseURL) {
      console.warn(
        `[@developerehsan/api-client] Both "baseURL" and "activeEnvironment" are set; using activeEnvironment "${global.activeEnvironment}".`,
      );
    }
    base = resolved;
  }
  return moduleBaseURL ?? base;
}

/**
 * Fully resolve a request's configuration by applying library defaults, then
 * the global, module, and per-call layers in ascending precedence.
 */
export function resolveRequestConfig(
  global: GlobalConfig,
  moduleCfg: ModuleConfig | undefined,
  perCall: PerCallConfig | undefined,
): ResolvedRequestConfig {
  const baseURL = resolveBaseURL(global, moduleCfg?.baseURL);

  const timeout = perCall?.timeout ?? moduleCfg?.timeout ?? global.http?.timeout ?? 10000;

  const headers = mergeHeaders(global.http?.headers, moduleCfg?.headers, perCall?.headers);

  const auth = deepMerge<AuthConfig>(
    { strategy: 'none' } as AuthConfig,
    (global.auth ?? {}) as Partial<AuthConfig>,
    (moduleCfg?.auth ?? {}) as Partial<AuthConfig>,
  );

  const cache = deepMerge<ResolvedRequestConfig['cache']>(
    { enabled: true, ttl: 60000, strategy: 'cache-first', maxSize: 500 },
    global.cache ?? {},
    moduleCfg?.cache ?? {},
    perCall?.cache ?? {},
  );
  if (perCall?.cache?.bust !== undefined) cache.bust = perCall.cache.bust;

  const retry = deepMerge<ResolvedRequestConfig['retry']>(
    {
      attempts: 3,
      backoff: 'exponential',
      baseDelay: 500,
      maxDelay: 30000,
      jitter: true,
    },
    global.http?.retry ?? {},
    moduleCfg?.retry ?? {},
    perCall?.retry ?? {},
  );

  const tenancy = deepMerge(
    { headerName: 'X-Tenant-ID' },
    global.tenancy ?? {},
    moduleCfg?.tenancy ?? {},
  );

  const validation = deepMerge(global.openapi?.validation ?? {}, moduleCfg?.validation ?? {});

  const resolved: ResolvedRequestConfig = {
    baseURL,
    timeout,
    headers,
    auth,
    cache,
    retry,
    tenancy,
    validation,
    skipAuth: perCall?.skipAuth ?? false,
    skipDedup: perCall?.skipDedup ?? false,
    responseType: perCall?.responseType ?? 'json',
    safeMode: global.safeMode ?? false,
  };

  if (perCall?.signal !== undefined) resolved.signal = perCall.signal;
  if (perCall?.tenantId !== undefined) resolved.tenantId = perCall.tenantId;

  return resolved;
}
