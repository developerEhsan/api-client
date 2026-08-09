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
  /** Logical labels this entry is filed under, for tag-based invalidation. */
  tags?: string[];
  /**
   * The runtime OpenAPI schema hash active when this entry was written
   * (spec 08.7). A read whose CURRENT schema hash differs is treated as a
   * miss (evicted, refetched) — this prevents a deploy that changes
   * response shapes from serving old-shaped cached data to a newly
   * deployed frontend expecting the new shape.
   */
  schemaHash?: string;
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
   * Maximum approximate total size (bytes) of all L1 entries. When set, this
   * bounds eviction ALONGSIDE `maxSize` — whichever limit is hit first
   * triggers LRU eviction. Size is estimated cheaply (JSON length of `data`
   * + `headers`), not exact — a reasonable pressure-relief signal, not a
   * hard memory guarantee.
   * @default optional, unset means only `maxSize` (count) bounds the cache
   */
  maxSizeBytes?: number;
  /**
   * Storage topology:
   * - `'layered'` (default) — sync in-memory L1 in front of the optional L2.
   * - `'l1-only'` — ignore `persistentStore` even if set (mostly for tests).
   * - `'l2-only'` — a tiny, bounded shadow L1 (just enough to avoid a network
   *   round-trip for an immediately-repeated read) in front of
   *   `persistentStore`, trading local memory for latency. Requires
   *   `persistentStore` to be set.
   * @default 'layered'
   */
  mode?: 'layered' | 'l1-only' | 'l2-only';
  /**
   * Node-only. When set, periodically checks `process.memoryUsage().rss` and
   * proactively evicts the oldest entries when it crosses the threshold,
   * ahead of `maxSize`/`maxSizeBytes` limits. No-ops outside Node (edge/
   * browser) — feature-detected, safe to set anywhere.
   * @default optional, unset means no proactive pressure-based eviction
   */
  memoryPressure?: { thresholdMb: number; checkIntervalMs?: number };
  /**
   * HTTP error statuses (e.g. `404`) that should be cached ("negative
   * caching") instead of hitting the network on every repeat lookup for a
   * resource that doesn't exist. A cache hit on one of these still rejects
   * the call (same as a live request would) — this only saves the network
   * round-trip, it does not turn an error into a success.
   * @default optional, unset means no status is negative-cached
   */
  cacheableStatuses?: number[];
  /**
   * TTL applied to a negative-cached entry (see {@link cacheableStatuses}),
   * usually shorter than the normal success TTL.
   * @default falls back to the normal `ttl`
   */
  negativeTtl?: number;
  /**
   * Minimal circuit breaker for a failing persistent (L2) store (spec
   * 08.4): after `failureThreshold` consecutive L2 failures, stop
   * attempting L2 calls for `cooldownMs` (serve L1-only — the same
   * degraded-but-safe fallback L2 failures already have, just without the
   * repeated timeout cost). Re-probes after cooldown.
   * @default optional, unset means no circuit breaker
   */
  circuitBreaker?: { failureThreshold: number; cooldownMs: number };
  /**
   * Fires on a persistent (L2) store failure, or a circuit-breaker state
   * transition (`op: 'circuit-open' | 'circuit-close'`). Never receives
   * cached `data` — error + operation context only.
   * @default optional, unset means silent swallow-and-degrade (today's behavior)
   */
  onStoreError?: (
    error: unknown,
    context: {
      op: 'get' | 'set' | 'delete' | 'clear' | 'circuit-open' | 'circuit-close';
      key?: string;
    },
  ) => void;
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
   * Extra key dimensions merged INTO the default (or `keyResolver`'s) key —
   * safer than `keyResolver` for the common case of "add one more thing to
   * the scope" (e.g. an admin viewing "as" a target user, or the active
   * workspace in a multi-tenant dashboard) without losing tenant/
   * auth-fingerprint isolation: every value here is folded into the same
   * hash the built-in key derivation already applies to tenant/
   * authFingerprint, so cross-scope isolation holds by construction.
   *
   * **If your endpoint's response depends on a value, that value MUST
   * appear either in the URL or here, or responses can leak across
   * contexts** (e.g. two admins "viewing as" different users would
   * otherwise share one cached response). Set statically (module/global/
   * per-call config) or per auto-method descriptor via
   * `AutoMethodDescriptor.cacheKeyParts(args)`; both are unioned.
   * @default optional, unset means no extra key parts
   */
  cacheKeyParts?: Record<string, string>;
  /**
   * Called whenever an entry is evicted (LRU eviction or expiry).
   * @default optional, unset means no eviction callback
   */
  onEvict?: (key: CacheKey, entry: CacheEntry) => void;
  /**
   * Optional persistent L2 store (IndexedDB, Redis, …) layered behind the
   * in-memory L1 via write-through + background read-warming. Global-level only;
   * see `@developerehsan/api-client/cache-stores`.
   * @default optional, unset means memory-only caching
   */
  persistentStore?: import('../cache-stores/store.types').PersistentCacheStore;
}
