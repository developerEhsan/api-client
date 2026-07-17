/**
 * Pluggable persistent cache stores (roadmap E4). The core client keeps a fast
 * synchronous in-memory LRU as L1; a `PersistentCacheStore` is an optional async
 * L2 (IndexedDB, Redis, …) layered behind it via write-through + read-warming,
 * so the hot path never gains an await.
 *
 * SECURITY: entries are stored under the client's tenant/auth-fingerprinted keys
 * (see `computeCacheKey`), so a persisted L2 keeps the same cross-tenant
 * isolation as L1. Persisted response bodies may be sensitive — clear the store
 * on logout (`store.clear()`); never persist raw auth material.
 */
import type { CacheEntry } from '../types/cache.types';

/**
 * An asynchronous key/value store for cache entries. Implementations must
 * round-trip a {@link CacheEntry} by JSON-serializable value (data/status/
 * headers/timestamps). All methods reject only on genuine backend failure.
 */
export interface PersistentCacheStore {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** True when a plain object structurally looks like a {@link CacheEntry}. */
export function isCacheEntry(value: unknown): value is CacheEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e['key'] === 'string' &&
    typeof e['status'] === 'number' &&
    typeof e['storedAt'] === 'number' &&
    typeof e['expiresAt'] === 'number'
  );
}
