/**
 * Cache layer types.
 */

import type { ApiRequest } from './http.types';

/**
 * Read strategy for the response cache:
 * - `'cache-first'` — serve a fresh cache entry without touching the network.
 * - `'network-first'` — try the network first, fall back to cache on failure.
 * - `'stale-while-revalidate'` — serve the stale entry immediately, then
 *   refresh it in the background.
 */
export type CacheStrategy = 'cache-first' | 'network-first' | 'stale-while-revalidate';

/** Opaque cache-key string identifying a cached response. */
export type CacheKey = string;

/**
 * A single stored response in the cache. Produced by the client when a
 * response is cached and passed to `onEvict`/`onCacheHit` callbacks.
 */
export interface CacheEntry<T = unknown> {
  /** Cache key this entry is stored under. */
  key: CacheKey;
  /** Cached response body. */
  data: T;
  /** HTTP status code of the cached response. */
  status: number;
  /** Response headers captured at cache time. */
  headers: Record<string, string>;
  /** Epoch ms when the entry was written. */
  storedAt: number;
  /** Epoch ms after which the entry is considered stale. */
  expiresAt: number;
}

/**
 * Response-cache configuration. Governs whether, how long, and by what
 * strategy responses are cached. Applies at the global or module layer.
 *
 * @example
 * ```ts
 * cache: {
 *   enabled: true,
 *   ttl: 60_000,
 *   maxSize: 500,
 *   // strategy: 'cache-first'            // serve fresh cache, skip the network
 *   // strategy: 'network-first'          // hit the network, fall back to cache on failure
 *   strategy: 'stale-while-revalidate',   // serve stale now, refresh in the background
 * }
 * ```
 */
export interface CacheConfig {
  /**
   * Master switch for the cache.
   * @default true
   */
  enabled?: boolean;
  /**
   * Entry lifetime in milliseconds; past this an entry is stale.
   * @default 60000
   */
  ttl?: number;
  /**
   * Read strategy (see {@link CacheStrategy}).
   * @default 'cache-first'
   */
  strategy?: CacheStrategy;
  /**
   * Maximum number of entries in the LRU store; least-recently-used entries
   * are evicted once exceeded.
   * @default 500
   */
  maxSize?: number;
  /**
   * Custom cache-key function. When unset, keys are derived from
   * method + url + auth-fingerprint + tenant.
   * @default optional, unset means the built-in key derivation is used
   * @example
   * ```ts
   * // Key solely by method + path, ignoring query params.
   * keyResolver: (req) => `${req.method}:${new URL(req.url).pathname}`
   * ```
   */
  keyResolver?: (request: ApiRequest) => string;
  /**
   * Called whenever an entry is evicted (LRU eviction or expiry).
   * @default optional, unset means no eviction callback
   */
  onEvict?: (key: CacheKey, entry: CacheEntry) => void;
}
