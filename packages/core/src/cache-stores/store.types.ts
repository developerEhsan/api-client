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
 * Cross-instance invalidation broadcast payload (roadmap `02`). Carries only
 * opaque tags/keys — NEVER cached response data, headers, or auth material.
 * `origin` is a random id generated once per client instance, used by a
 * subscriber to ignore its own echoed publish.
 */
export interface InvalidationMessage {
  type: 'tags' | 'keys' | 'clear';
  /** Present when `type` is `'tags'` or `'keys'`. Opaque strings only. */
  values?: string[];
  origin: string;
}

/**
 * What a caller passes to {@link PersistentCacheStore.publishInvalidate} —
 * `origin` is stamped by the store itself (it owns the per-instance id), not
 * supplied by the caller.
 */
export type OutgoingInvalidationMessage = Omit<InvalidationMessage, 'origin'>;

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
  /**
   * Optional (roadmap `02`). When present, the client factory subscribes
   * once at construction time and applies incoming invalidations to the
   * LOCAL L1 cache + tag index. Plain stores without this behave exactly as
   * they do today — this is additive, never a required capability.
   */
  onRemoteInvalidate?(handler: (msg: InvalidationMessage) => void): void;
  /**
   * Optional (roadmap `02`). Broadcast a local invalidation to sibling
   * instances. Fire-and-forget from the caller's perspective — a rejection
   * must never surface to the request pipeline.
   */
  publishInvalidate?(msg: OutgoingInvalidationMessage): Promise<void>;
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
