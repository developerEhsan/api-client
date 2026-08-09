/**
 * In-memory LRU cache with TTL, glob invalidation, and tenant/auth-scoped keys.
 * Pure and IO-free; recency is tracked via Map insertion order.
 */

import type { CacheConfig, CacheEntry } from '../types/cache.types';

/** Default maximum number of entries retained before LRU eviction (spec 6.3). */
const DEFAULT_MAX_SIZE = 500;

/** A synchronous key/value cache store with LRU eviction and TTL awareness. */
export interface CacheStore {
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  /** Glob invalidation: '*' wildcard. e.g. 'invoices.*'. Returns count removed. */
  invalidate(pattern: string): number;
  /** Read-only preview (spec 08.8): keys `invalidate(pattern)` would remove, without removing them. */
  keysMatching(pattern: string): string[];
  size(): number;
  /** True when entry exists but expiresAt < now (stale-but-present, for SWR). */
  isStale(key: string): boolean;
}

/** An in-memory {@link CacheStore} with a proactive-eviction escape hatch (spec 03). */
export interface LruCacheStore extends CacheStore {
  /** Evict the `count` least-recently-used entries, firing `onEvict` for each. */
  evictOldest(count: number): void;
}

/**
 * Cheap, non-exact estimate of an entry's footprint in bytes (spec 03): the
 * JSON length of `data` + `headers`. Never throws — circular references or
 * other non-serializable values fall back to `0` rather than breaking the
 * write path.
 */
export function estimateEntrySize(entry: CacheEntry): number {
  try {
    return JSON.stringify(entry.data).length + JSON.stringify(entry.headers).length;
  } catch {
    return 0;
  }
}

/**
 * Create an LRU cache store.
 *
 * - Evicts the least-recently-USED entry when `size` would exceed `maxSize`
 *   (both {@link CacheStore.get} and {@link CacheStore.set} count as a use).
 * - Fires `config.onEvict(key, entry)` for entries removed by overflow (C3).
 */
export function createCache(
  config?: Pick<CacheConfig, 'maxSize' | 'maxSizeBytes' | 'onEvict'>,
): LruCacheStore {
  const maxSize = config?.maxSize ?? DEFAULT_MAX_SIZE;
  const maxSizeBytes = config?.maxSizeBytes;
  const onEvict = config?.onEvict;
  const store = new Map<string, CacheEntry>();
  const sizes = new Map<string, number>();
  let totalBytes = 0;

  /** Remove `key`'s byte contribution from the running total, if tracked. */
  const untrackBytes = (key: string): void => {
    const size = sizes.get(key);
    if (size !== undefined) {
      totalBytes -= size;
      sizes.delete(key);
    }
  };

  /** Record `entry`'s estimated byte size for `key`, replacing any prior size. */
  const trackBytes = (key: string, entry: CacheEntry): void => {
    untrackBytes(key);
    const size = estimateEntrySize(entry);
    sizes.set(key, size);
    totalBytes += size;
  };

  /** Move `key` to the most-recently-used position (Map tail). */
  const bump = (key: string, entry: CacheEntry): void => {
    store.delete(key);
    store.set(key, entry);
  };

  /** Remove the single oldest (Map head) entry, firing `onEvict`. No-op if empty. */
  const evictOne = (): boolean => {
    const oldest = store.keys().next();
    if (oldest.done === true) return false;
    const key = oldest.value;
    const entry = store.get(key);
    store.delete(key);
    untrackBytes(key);
    if (entry !== undefined) onEvict?.(key, entry);
    return true;
  };

  /** Evict least-recently-used entries until within `maxSize` and `maxSizeBytes`. */
  const evictOverflow = (): void => {
    while (store.size > maxSize || (maxSizeBytes !== undefined && totalBytes > maxSizeBytes)) {
      if (!evictOne()) break;
    }
  };

  return {
    get(key: string): CacheEntry | undefined {
      const entry = store.get(key);
      if (entry === undefined) return undefined;
      bump(key, entry);
      return entry;
    },

    set(key: string, entry: CacheEntry): void {
      bump(key, entry);
      trackBytes(key, entry);
      evictOverflow();
    },

    has(key: string): boolean {
      return store.has(key);
    },

    delete(key: string): boolean {
      untrackBytes(key);
      return store.delete(key);
    },

    clear(): void {
      store.clear();
      sizes.clear();
      totalBytes = 0;
    },

    invalidate(pattern: string): number {
      let removed = 0;
      for (const key of matchKeys(store, pattern)) {
        store.delete(key);
        untrackBytes(key);
        removed += 1;
      }
      return removed;
    },

    keysMatching(pattern: string): string[] {
      return matchKeys(store, pattern);
    },

    size(): number {
      return store.size;
    },

    isStale(key: string): boolean {
      const entry = store.get(key);
      if (entry === undefined) return false;
      return entry.expiresAt < Date.now();
    },

    evictOldest(count: number): void {
      for (let i = 0; i < count; i += 1) {
        if (!evictOne()) break;
      }
    },
  };
}

/**
 * Whether `entry` is still fresh (not past its `expiresAt`) at `now` (C1).
 * Defaults `now` to {@link Date.now}. An entry is fresh while `now <= expiresAt`.
 */
export function isFresh(entry: CacheEntry, now: number = Date.now()): boolean {
  return now <= entry.expiresAt;
}

/**
 * Build a deterministic, collision-resistant cache key.
 *
 * The key keeps a human-readable `method:url` prefix, then appends a hash of the
 * tenant id and auth fingerprint so requests from different tenants or auth
 * contexts never share a cache entry (C8 cross-tenant leak prevention).
 */
export function computeCacheKey(input: {
  method: string;
  url: string;
  tenantId?: string;
  authFingerprint?: string;
  /** Extra key dimensions (spec 10), folded into the same hashed scope. */
  extraParts?: Record<string, string>;
}): string {
  const prefix = `${input.method.toUpperCase()}:${input.url}`;
  // Sorted for determinism — `{a,b}` and `{b,a}` must hash identically
  // regardless of insertion order.
  const extra = input.extraParts
    ? Object.entries(input.extraParts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&')
    : '';
  const scope = `${input.tenantId ?? ''}|${input.authFingerprint ?? ''}|${extra}`;
  return `${prefix}#${hash(scope)}`;
}

/**
 * Fold extra key parts (spec 10) onto an already-computed key string, e.g. a
 * `keyResolver`'s full-override output. Kept separate from
 * {@link computeCacheKey} since a `keyResolver`'s `base` is an opaque string,
 * not a `method:url` pair to re-derive.
 */
export function foldExtraKeyParts(base: string, extraParts?: Record<string, string>): string {
  if (!extraParts || Object.keys(extraParts).length === 0) return base;
  const extra = Object.entries(extraParts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `${base}#${hash(extra)}`;
}

/** Key names that must never be used — same blocklist `deepMerge` uses against prototype pollution. */
const BLOCKED_KEY_PARTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Defensively sanitize a {@link CacheConfig.cacheKeyParts}-style record before
 * it reaches {@link computeCacheKey} (spec 10): every value is coerced to a
 * string (the source may be developer-supplied and untyped at the boundary),
 * and dangerous key names are dropped rather than reaching `Object` machinery.
 */
export function sanitizeKeyParts(parts: Record<string, unknown>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(parts)) {
    if (BLOCKED_KEY_PARTS.has(key)) continue;
    sanitized[key] = String(value);
  }
  return sanitized;
}

/** Escape regex metacharacters except `*`, which becomes `.*`. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Keys in `store` matching `pattern` — shared by `invalidate()` and the read-only `keysMatching()`. */
function matchKeys(store: Map<string, CacheEntry>, pattern: string): string[] {
  const regex = globToRegExp(pattern);
  return [...store.keys()].filter((key) => regex.test(key));
}

/** Deterministic FNV-1a 32-bit hash rendered as base-36. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
