import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CacheEntry } from '../types/cache.types';
import {
  computeCacheKey,
  createCache,
  foldExtraKeyParts,
  isFresh,
  sanitizeKeyParts,
} from './cache';

function makeEntry(key: string, expiresAt = 0): CacheEntry {
  return {
    key,
    data: { key },
    status: 200,
    headers: {},
    storedAt: 0,
    expiresAt,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createCache LRU', () => {
  it('evicts the least-recently-used entry and fires onEvict', () => {
    const evicted: Array<[string, CacheEntry]> = [];
    const cache = createCache({
      maxSize: 2,
      onEvict: (k, e) => evicted.push([k, e]),
    });

    const a = makeEntry('a');
    const b = makeEntry('b');
    const c = makeEntry('c');
    cache.set('a', a);
    cache.set('b', b);
    // touch 'a' so 'b' becomes LRU
    cache.get('a');
    cache.set('c', c);

    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.size()).toBe(2);
    expect(evicted).toEqual([['b', b]]);
  });

  it('defaults maxSize to 500', () => {
    const cache = createCache();
    for (let i = 0; i < 500; i += 1) cache.set(`k${i}`, makeEntry(`k${i}`));
    expect(cache.size()).toBe(500);
    cache.set('overflow', makeEntry('overflow'));
    expect(cache.size()).toBe(500);
    expect(cache.has('k0')).toBe(false);
  });

  it('supports delete and clear', () => {
    const cache = createCache();
    cache.set('a', makeEntry('a'));
    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    cache.set('b', makeEntry('b'));
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});

describe('maxSizeBytes', () => {
  it('evicts oldest entries once the running byte estimate exceeds the cap, independent of maxSize', () => {
    const evicted: string[] = [];
    // maxSize is generous (10); only the byte cap should trigger eviction.
    const cache = createCache({
      maxSize: 10,
      maxSizeBytes: 50,
      onEvict: (k) => evicted.push(k),
    });

    // Each entry's JSON is well over 10 bytes, so a few entries should
    // exceed the 50-byte cap well before hitting maxSize.
    cache.set('a', makeEntry('a'));
    cache.set('b', makeEntry('b'));
    cache.set('c', makeEntry('c'));
    cache.set('d', makeEntry('d'));

    expect(cache.size()).toBeLessThan(4);
    expect(evicted.length).toBeGreaterThan(0);
    // Oldest-first: 'a' should be among the first evicted.
    expect(evicted[0]).toBe('a');
  });

  it('falls back to size 0 for non-serializable data instead of throwing', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const cache = createCache({ maxSizeBytes: 1 });
    expect(() => cache.set('a', { ...makeEntry('a'), data: circular })).not.toThrow();
    expect(cache.has('a')).toBe(true);
  });
});

describe('evictOldest', () => {
  it('evicts the N least-recently-used entries and fires onEvict for each', () => {
    const evicted: string[] = [];
    const cache = createCache({ maxSize: 100, onEvict: (k) => evicted.push(k) });
    cache.set('a', makeEntry('a'));
    cache.set('b', makeEntry('b'));
    cache.set('c', makeEntry('c'));

    cache.evictOldest(2);

    expect(evicted).toEqual(['a', 'b']);
    expect(cache.has('c')).toBe(true);
    expect(cache.size()).toBe(1);
  });

  it('stops cleanly when asked to evict more than exist', () => {
    const cache = createCache();
    cache.set('a', makeEntry('a'));
    expect(() => cache.evictOldest(5)).not.toThrow();
    expect(cache.size()).toBe(0);
  });
});

describe('TTL / staleness', () => {
  it('isFresh compares against injected now', () => {
    const entry = makeEntry('a', 1000);
    expect(isFresh(entry, 999)).toBe(true);
    expect(isFresh(entry, 1000)).toBe(true);
    expect(isFresh(entry, 1001)).toBe(false);
  });

  it('isStale uses Date.now for stale-but-present entries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cache = createCache();
    cache.set('a', makeEntry('a', 500));
    expect(cache.isStale('a')).toBe(false);
    vi.setSystemTime(600);
    expect(cache.isStale('a')).toBe(true);
    expect(cache.isStale('missing')).toBe(false);
  });
});

describe('glob invalidate', () => {
  it('removes entries matching a wildcard and escapes regex chars', () => {
    const cache = createCache();
    cache.set('invoices.list', makeEntry('invoices.list'));
    cache.set('invoices.get', makeEntry('invoices.get'));
    cache.set('users.list', makeEntry('users.list'));

    expect(cache.invalidate('invoices.*')).toBe(2);
    expect(cache.has('invoices.list')).toBe(false);
    expect(cache.has('users.list')).toBe(true);
  });

  it('keysMatching (dry run) returns the same set invalidate() would remove, without removing anything', () => {
    const cache = createCache();
    cache.set('invoices.list', makeEntry('invoices.list'));
    cache.set('invoices.get', makeEntry('invoices.get'));
    cache.set('users.list', makeEntry('users.list'));

    const preview = cache.keysMatching('invoices.*');
    expect(new Set(preview)).toEqual(new Set(['invoices.list', 'invoices.get']));
    // Nothing was actually removed.
    expect(cache.has('invoices.list')).toBe(true);
    expect(cache.has('invoices.get')).toBe(true);
    expect(cache.size()).toBe(3);

    // A subsequent real invalidate with the same pattern removes exactly that set.
    expect(cache.invalidate('invoices.*')).toBe(2);
    expect(cache.has('invoices.list')).toBe(false);
    expect(cache.has('invoices.get')).toBe(false);
  });

  it('treats dots literally (no regex wildcard leak)', () => {
    const cache = createCache();
    cache.set('axb', makeEntry('axb'));
    cache.set('a.b', makeEntry('a.b'));
    expect(cache.invalidate('a.b')).toBe(1);
    expect(cache.has('axb')).toBe(true);
    expect(cache.has('a.b')).toBe(false);
  });
});

describe('computeCacheKey', () => {
  it('keeps a human-readable method:url prefix', () => {
    const key = computeCacheKey({ method: 'get', url: '/invoices' });
    expect(key.startsWith('GET:/invoices#')).toBe(true);
  });

  it('produces different keys for different tenants', () => {
    const base = { method: 'GET', url: '/invoices' };
    const t1 = computeCacheKey({ ...base, tenantId: 't1' });
    const t2 = computeCacheKey({ ...base, tenantId: 't2' });
    expect(t1).not.toBe(t2);
  });

  it('produces different keys for different auth fingerprints', () => {
    const base = { method: 'GET', url: '/invoices', tenantId: 't1' };
    const a = computeCacheKey({ ...base, authFingerprint: 'aaa' });
    const b = computeCacheKey({ ...base, authFingerprint: 'bbb' });
    expect(a).not.toBe(b);
  });

  it('is deterministic', () => {
    const input = { method: 'GET', url: '/x', tenantId: 't', authFingerprint: 'f' };
    expect(computeCacheKey(input)).toBe(computeCacheKey(input));
  });
});

describe('computeCacheKey extraParts (spec 10)', () => {
  const base = { method: 'GET', url: '/dashboard/summary', tenantId: 't1', authFingerprint: 'f1' };

  it('produces a different key than without extraParts', () => {
    const without = computeCacheKey(base);
    const withParts = computeCacheKey({ ...base, extraParts: { workspaceId: 'w1' } });
    expect(withParts).not.toBe(without);
  });

  it('is order-independent — {a,b} and {b,a} hash identically', () => {
    const ab = computeCacheKey({ ...base, extraParts: { a: '1', b: '2' } });
    const ba = computeCacheKey({ ...base, extraParts: { b: '2', a: '1' } });
    expect(ab).toBe(ba);
  });

  it('different extraParts values produce independent keys', () => {
    const w1 = computeCacheKey({ ...base, extraParts: { workspaceId: 'w1' } });
    const w2 = computeCacheKey({ ...base, extraParts: { workspaceId: 'w2' } });
    expect(w1).not.toBe(w2);
  });
});

describe('sanitizeKeyParts (spec 10)', () => {
  it('coerces values to strings', () => {
    expect(sanitizeKeyParts({ a: 1, b: true } as unknown as Record<string, unknown>)).toEqual({
      a: '1',
      b: 'true',
    });
  });

  it('strips __proto__/constructor/prototype keys without polluting Object.prototype', () => {
    const malicious = JSON.parse(
      '{"__proto__": {"polluted": true}, "constructor": "x", "safe": "ok"}',
    ) as Record<string, unknown>;
    const sanitized = sanitizeKeyParts(malicious);
    expect(sanitized).toEqual({ safe: 'ok' });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('never crashes on a hostile key name', () => {
    expect(() => sanitizeKeyParts({ prototype: 'x', safe: 'ok' })).not.toThrow();
  });
});

describe('foldExtraKeyParts (spec 10)', () => {
  it('returns base unchanged when extraParts is empty/unset', () => {
    expect(foldExtraKeyParts('some-base-key')).toBe('some-base-key');
    expect(foldExtraKeyParts('some-base-key', {})).toBe('some-base-key');
  });

  it('appends a deterministic, order-independent suffix', () => {
    const ab = foldExtraKeyParts('base', { a: '1', b: '2' });
    const ba = foldExtraKeyParts('base', { b: '2', a: '1' });
    expect(ab).toBe(ba);
    expect(ab).not.toBe('base');
    expect(ab.startsWith('base#')).toBe(true);
  });

  it('different extraParts values fold to different suffixes', () => {
    const w1 = foldExtraKeyParts('base', { workspaceId: 'w1' });
    const w2 = foldExtraKeyParts('base', { workspaceId: 'w2' });
    expect(w1).not.toBe(w2);
  });
});
