/**
 * In-memory LRU cache with TTL, glob invalidation, and tenant/auth-scoped keys.
 * Pure and IO-free; recency is tracked via Map insertion order.
 */

import type { CacheConfig, CacheEntry } from '../types/cache.types'

/** Default maximum number of entries retained before LRU eviction (spec 6.3). */
const DEFAULT_MAX_SIZE = 500

/** A synchronous key/value cache store with LRU eviction and TTL awareness. */
export interface CacheStore {
  get(key: string): CacheEntry | undefined
  set(key: string, entry: CacheEntry): void
  has(key: string): boolean
  delete(key: string): boolean
  clear(): void
  /** Glob invalidation: '*' wildcard. e.g. 'invoices.*'. Returns count removed. */
  invalidate(pattern: string): number
  size(): number
  /** True when entry exists but expiresAt < now (stale-but-present, for SWR). */
  isStale(key: string): boolean
}

/**
 * Create an LRU cache store.
 *
 * - Evicts the least-recently-USED entry when `size` would exceed `maxSize`
 *   (both {@link CacheStore.get} and {@link CacheStore.set} count as a use).
 * - Fires `config.onEvict(key, entry)` for entries removed by overflow (C3).
 */
export function createCache(
  config?: Pick<CacheConfig, 'maxSize' | 'onEvict'>,
): CacheStore {
  const maxSize = config?.maxSize ?? DEFAULT_MAX_SIZE
  const onEvict = config?.onEvict
  const store = new Map<string, CacheEntry>()

  /** Move `key` to the most-recently-used position (Map tail). */
  const bump = (key: string, entry: CacheEntry): void => {
    store.delete(key)
    store.set(key, entry)
  }

  /** Evict least-recently-used entries until within `maxSize`. */
  const evictOverflow = (): void => {
    while (store.size > maxSize) {
      const oldest = store.keys().next()
      if (oldest.done === true) break
      const key = oldest.value
      const entry = store.get(key)
      store.delete(key)
      if (entry !== undefined) onEvict?.(key, entry)
    }
  }

  return {
    get(key: string): CacheEntry | undefined {
      const entry = store.get(key)
      if (entry === undefined) return undefined
      bump(key, entry)
      return entry
    },

    set(key: string, entry: CacheEntry): void {
      bump(key, entry)
      evictOverflow()
    },

    has(key: string): boolean {
      return store.has(key)
    },

    delete(key: string): boolean {
      return store.delete(key)
    },

    clear(): void {
      store.clear()
    },

    invalidate(pattern: string): number {
      const regex = globToRegExp(pattern)
      let removed = 0
      for (const key of [...store.keys()]) {
        if (regex.test(key)) {
          store.delete(key)
          removed += 1
        }
      }
      return removed
    },

    size(): number {
      return store.size
    },

    isStale(key: string): boolean {
      const entry = store.get(key)
      if (entry === undefined) return false
      return entry.expiresAt < Date.now()
    },
  }
}

/**
 * Whether `entry` is still fresh (not past its `expiresAt`) at `now` (C1).
 * Defaults `now` to {@link Date.now}. An entry is fresh while `now <= expiresAt`.
 */
export function isFresh(entry: CacheEntry, now: number = Date.now()): boolean {
  return now <= entry.expiresAt
}

/**
 * Build a deterministic, collision-resistant cache key.
 *
 * The key keeps a human-readable `method:url` prefix, then appends a hash of the
 * tenant id and auth fingerprint so requests from different tenants or auth
 * contexts never share a cache entry (C8 cross-tenant leak prevention).
 */
export function computeCacheKey(input: {
  method: string
  url: string
  tenantId?: string
  authFingerprint?: string
}): string {
  const prefix = `${input.method.toUpperCase()}:${input.url}`
  const scope = `${input.tenantId ?? ''}|${input.authFingerprint ?? ''}`
  return `${prefix}#${hash(scope)}`
}

/** Escape regex metacharacters except `*`, which becomes `.*`. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

/** Deterministic FNV-1a 32-bit hash rendered as base-36. */
function hash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
