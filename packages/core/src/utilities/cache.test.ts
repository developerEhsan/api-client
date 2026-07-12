import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CacheEntry } from '../types/cache.types'
import { computeCacheKey, createCache, isFresh } from './cache'

function makeEntry(key: string, expiresAt = 0): CacheEntry {
  return {
    key,
    data: { key },
    status: 200,
    headers: {},
    storedAt: 0,
    expiresAt,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createCache LRU', () => {
  it('evicts the least-recently-used entry and fires onEvict', () => {
    const evicted: Array<[string, CacheEntry]> = []
    const cache = createCache({
      maxSize: 2,
      onEvict: (k, e) => evicted.push([k, e]),
    })

    const a = makeEntry('a')
    const b = makeEntry('b')
    const c = makeEntry('c')
    cache.set('a', a)
    cache.set('b', b)
    // touch 'a' so 'b' becomes LRU
    cache.get('a')
    cache.set('c', c)

    expect(cache.has('b')).toBe(false)
    expect(cache.has('a')).toBe(true)
    expect(cache.has('c')).toBe(true)
    expect(cache.size()).toBe(2)
    expect(evicted).toEqual([['b', b]])
  })

  it('defaults maxSize to 500', () => {
    const cache = createCache()
    for (let i = 0; i < 500; i += 1) cache.set(`k${i}`, makeEntry(`k${i}`))
    expect(cache.size()).toBe(500)
    cache.set('overflow', makeEntry('overflow'))
    expect(cache.size()).toBe(500)
    expect(cache.has('k0')).toBe(false)
  })

  it('supports delete and clear', () => {
    const cache = createCache()
    cache.set('a', makeEntry('a'))
    expect(cache.delete('a')).toBe(true)
    expect(cache.delete('a')).toBe(false)
    cache.set('b', makeEntry('b'))
    cache.clear()
    expect(cache.size()).toBe(0)
  })
})

describe('TTL / staleness', () => {
  it('isFresh compares against injected now', () => {
    const entry = makeEntry('a', 1000)
    expect(isFresh(entry, 999)).toBe(true)
    expect(isFresh(entry, 1000)).toBe(true)
    expect(isFresh(entry, 1001)).toBe(false)
  })

  it('isStale uses Date.now for stale-but-present entries', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const cache = createCache()
    cache.set('a', makeEntry('a', 500))
    expect(cache.isStale('a')).toBe(false)
    vi.setSystemTime(600)
    expect(cache.isStale('a')).toBe(true)
    expect(cache.isStale('missing')).toBe(false)
  })
})

describe('glob invalidate', () => {
  it('removes entries matching a wildcard and escapes regex chars', () => {
    const cache = createCache()
    cache.set('invoices.list', makeEntry('invoices.list'))
    cache.set('invoices.get', makeEntry('invoices.get'))
    cache.set('users.list', makeEntry('users.list'))

    expect(cache.invalidate('invoices.*')).toBe(2)
    expect(cache.has('invoices.list')).toBe(false)
    expect(cache.has('users.list')).toBe(true)
  })

  it('treats dots literally (no regex wildcard leak)', () => {
    const cache = createCache()
    cache.set('axb', makeEntry('axb'))
    cache.set('a.b', makeEntry('a.b'))
    expect(cache.invalidate('a.b')).toBe(1)
    expect(cache.has('axb')).toBe(true)
    expect(cache.has('a.b')).toBe(false)
  })
})

describe('computeCacheKey', () => {
  it('keeps a human-readable method:url prefix', () => {
    const key = computeCacheKey({ method: 'get', url: '/invoices' })
    expect(key.startsWith('GET:/invoices#')).toBe(true)
  })

  it('produces different keys for different tenants', () => {
    const base = { method: 'GET', url: '/invoices' }
    const t1 = computeCacheKey({ ...base, tenantId: 't1' })
    const t2 = computeCacheKey({ ...base, tenantId: 't2' })
    expect(t1).not.toBe(t2)
  })

  it('produces different keys for different auth fingerprints', () => {
    const base = { method: 'GET', url: '/invoices', tenantId: 't1' }
    const a = computeCacheKey({ ...base, authFingerprint: 'aaa' })
    const b = computeCacheKey({ ...base, authFingerprint: 'bbb' })
    expect(a).not.toBe(b)
  })

  it('is deterministic', () => {
    const input = { method: 'GET', url: '/x', tenantId: 't', authFingerprint: 'f' }
    expect(computeCacheKey(input)).toBe(computeCacheKey(input))
  })
})
