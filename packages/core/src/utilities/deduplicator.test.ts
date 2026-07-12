import { describe, expect, it, vi } from 'vitest'

import { computeDedupeKey, createDeduplicator } from './deduplicator'

describe('createDeduplicator', () => {
  it('D1: N concurrent identical calls invoke the factory once and share one promise', async () => {
    const dedup = createDeduplicator()
    const factory = vi.fn(async () => 'result')

    const promises = [
      dedup.dedupe('k', factory),
      dedup.dedupe('k', factory),
      dedup.dedupe('k', factory),
    ]

    expect(dedup.inFlight()).toBe(1)
    expect(dedup.subscribers('k')).toBe(3)

    const results = await Promise.all(promises)
    expect(results).toEqual(['result', 'result', 'result'])
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('D3: a rejecting factory delivers the same error to every sharer', async () => {
    const dedup = createDeduplicator()
    const error = new Error('boom')
    const factory = vi.fn(async () => {
      throw error
    })

    const p1 = dedup.dedupe('k', factory)
    const p2 = dedup.dedupe('k', factory)

    await expect(p1).rejects.toBe(error)
    await expect(p2).rejects.toBe(error)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('re-runs the factory for a key after it has settled', async () => {
    const dedup = createDeduplicator()
    const factory = vi.fn(async () => 'x')

    await dedup.dedupe('k', factory)
    expect(dedup.inFlight()).toBe(0)

    await dedup.dedupe('k', factory)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('re-runs after a rejection settles', async () => {
    const dedup = createDeduplicator()
    const factory = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('first'))
      .mockResolvedValueOnce('ok')

    await expect(dedup.dedupe('k', factory)).rejects.toThrow('first')
    expect(dedup.inFlight()).toBe(0)
    await expect(dedup.dedupe('k', factory)).resolves.toBe('ok')
  })

  it('tracks subscriber counts across distinct keys', async () => {
    const dedup = createDeduplicator()
    const factory = vi.fn(async () => 1)

    void dedup.dedupe('a', factory)
    void dedup.dedupe('a', factory)
    void dedup.dedupe('b', factory)

    expect(dedup.subscribers('a')).toBe(2)
    expect(dedup.subscribers('b')).toBe(1)
    expect(dedup.subscribers('missing')).toBe(0)
    expect(dedup.inFlight()).toBe(2)
  })

  it('release returns true only for the last subscriber', () => {
    const dedup = createDeduplicator()
    const factory = vi.fn(async () => 1)

    void dedup.dedupe('k', factory)
    void dedup.dedupe('k', factory)

    expect(dedup.release('k')).toBe(false)
    expect(dedup.release('k')).toBe(true)
    expect(dedup.release('unknown')).toBe(false)
  })

  it('shares a slow in-flight promise until it resolves', async () => {
    vi.useFakeTimers()
    try {
      const dedup = createDeduplicator()
      const factory = vi.fn(
        () =>
          new Promise<number>((resolve) => {
            setTimeout(() => resolve(42), 1000)
          }),
      )

      const p1 = dedup.dedupe('k', factory)
      const p2 = dedup.dedupe('k', factory)
      expect(dedup.subscribers('k')).toBe(2)

      await vi.advanceTimersByTimeAsync(1000)

      expect(await p1).toBe(42)
      expect(await p2).toBe(42)
      expect(factory).toHaveBeenCalledTimes(1)
      expect(dedup.inFlight()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('computeDedupeKey', () => {
  it('is order-independent for body object keys', () => {
    const a = computeDedupeKey({ method: 'POST', url: '/x', body: { a: 1, b: 2 } })
    const b = computeDedupeKey({ method: 'POST', url: '/x', body: { b: 2, a: 1 } })
    expect(a).toBe(b)
  })

  it('is deterministic and produces an 8-char hex hash', () => {
    const key = computeDedupeKey({ method: 'GET', url: '/x' })
    expect(key).toBe(computeDedupeKey({ method: 'GET', url: '/x' }))
    expect(key).toMatch(/^[0-9a-f]{8}$/)
  })

  it('distinguishes method, url, body, and tenant', () => {
    const base = { method: 'GET', url: '/x' }
    expect(computeDedupeKey(base)).not.toBe(computeDedupeKey({ ...base, method: 'POST' }))
    expect(computeDedupeKey(base)).not.toBe(computeDedupeKey({ ...base, url: '/y' }))
    expect(computeDedupeKey(base)).not.toBe(computeDedupeKey({ ...base, tenantId: 't1' }))
    expect(computeDedupeKey(base)).not.toBe(computeDedupeKey({ ...base, body: { a: 1 } }))
  })

  it('normalizes method case', () => {
    expect(computeDedupeKey({ method: 'get', url: '/x' })).toBe(
      computeDedupeKey({ method: 'GET', url: '/x' }),
    )
  })
})
