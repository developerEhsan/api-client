/**
 * Cache layer types.
 */

import type { ApiRequest } from './http.types'

export type CacheStrategy =
  | 'cache-first'
  | 'network-first'
  | 'stale-while-revalidate'

export type CacheKey = string

export interface CacheEntry<T = unknown> {
  key: CacheKey
  data: T
  status: number
  headers: Record<string, string>
  /** Epoch ms when the entry was written. */
  storedAt: number
  /** Epoch ms after which the entry is considered stale. */
  expiresAt: number
}

export interface CacheConfig {
  enabled?: boolean
  ttl?: number
  strategy?: CacheStrategy
  maxSize?: number
  keyResolver?: (request: ApiRequest) => string
  onEvict?: (key: CacheKey, entry: CacheEntry) => void
}
