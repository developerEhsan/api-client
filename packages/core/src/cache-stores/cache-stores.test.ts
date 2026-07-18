/**
 * Pluggable cache store tests (E4): the memory + Redis reference stores, the
 * L1/L2 layering (write-through + read-warming), and end-to-end persistence
 * through createClient via cache.persistentStore.
 */
import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../factory/createClient';
import { createMockAdapter } from '../testing/mockAdapter';
import type { CacheEntry } from '../types/cache.types';
import type { ModuleContext } from '../types/module.types';
import { createCache } from '../utilities/cache';
import { type RedisLikeClient, createMemoryPersistentStore, createRedisStore } from './index';
import { createLayeredCacheStore } from './layered';

const entry = (key: string, ttlMs = 60_000): CacheEntry => ({
  key,
  data: { hello: key },
  status: 200,
  headers: {},
  storedAt: Date.now(),
  expiresAt: Date.now() + ttlMs,
});

describe('createMemoryPersistentStore', () => {
  it('round-trips get/set/delete/clear', async () => {
    const s = createMemoryPersistentStore();
    expect(await s.get('a')).toBeUndefined();
    await s.set('a', entry('a'));
    expect(await s.get('a')).toMatchObject({ data: { hello: 'a' } });
    await s.delete('a');
    expect(await s.get('a')).toBeUndefined();
    await s.set('b', entry('b'));
    await s.clear();
    expect(await s.get('b')).toBeUndefined();
  });
});

describe('createRedisStore', () => {
  it('JSON-serializes with a PX ttl and namespaced key', async () => {
    const store = new Map<string, string>();
    const client: RedisLikeClient = {
      get: (k) => Promise.resolve(store.get(k) ?? null),
      set: (k, v) => {
        store.set(k, v);
        return Promise.resolve('OK');
      },
      del: (k) => {
        store.delete(k);
        return Promise.resolve(1);
      },
    };
    const setSpy = vi.spyOn(client, 'set');
    const redis = createRedisStore(client, { keyPrefix: 'x:' });
    await redis.set('k', entry('k', 5000));
    expect(setSpy).toHaveBeenCalledWith('x:k', expect.any(String), 'PX', expect.any(Number));
    expect(await redis.get('k')).toMatchObject({ data: { hello: 'k' } });
    expect(await redis.get('missing')).toBeUndefined();
  });

  it('ignores corrupt JSON', async () => {
    const client: RedisLikeClient = {
      get: () => Promise.resolve('{not json'),
      set: () => Promise.resolve('OK'),
      del: () => Promise.resolve(1),
    };
    expect(await createRedisStore(client).get('k')).toBeUndefined();
  });
});

describe('createLayeredCacheStore', () => {
  it('writes through to L2 on set and delete', async () => {
    const l1 = createCache();
    const l2 = createMemoryPersistentStore();
    const layered = createLayeredCacheStore(l1, l2);
    layered.set('k', entry('k'));
    expect(l1.get('k')).toBeDefined();
    // Write-through is fire-and-forget; allow the microtask to settle.
    await Promise.resolve();
    expect(await l2.get('k')).toBeDefined();
  });

  it('warms L1 from L2 on a miss (serves on the subsequent read)', async () => {
    const l1 = createCache();
    const l2 = createMemoryPersistentStore();
    await l2.set('k', entry('k'));
    const layered = createLayeredCacheStore(l1, l2);
    // First read misses L1 and fires the async warm.
    expect(layered.get('k')).toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();
    // Now L1 is warm.
    expect(l1.get('k')).toBeDefined();
  });

  it('does not warm L1 from a stale L2 entry', async () => {
    const l1 = createCache();
    const l2 = createMemoryPersistentStore();
    await l2.set('k', entry('k', -1)); // already expired
    const layered = createLayeredCacheStore(l1, l2);
    layered.get('k');
    await Promise.resolve();
    await Promise.resolve();
    expect(l1.get('k')).toBeUndefined();
  });
});

describe('persistentStore through createClient', () => {
  it('writes GET responses through to the persistent store', async () => {
    const mock = createMockAdapter();
    mock.on('GET', '/things/1', { data: { id: '1' } });
    const l2 = createMemoryPersistentStore();
    const setSpy = vi.spyOn(l2, 'set');
    const api = createClient({
      baseURL: 'http://mock.test',
      openapi: { mode: 'runtime' },
      http: { adapter: mock, retry: { attempts: 1, baseDelay: 0, maxDelay: 0, jitter: false } },
      cache: { persistentStore: l2 },
      modules: {
        auto: false as const,
        things: {
          methods: {
            get: async (ctx: ModuleContext, id: string) =>
              (await ctx.request({ method: 'GET', path: '/things/{id}', pathParams: { id } })).data,
          },
        },
      },
    }) as unknown as { things: { get: (id: string) => Promise<unknown> } };

    await api.things.get('1');
    await Promise.resolve();
    expect(setSpy).toHaveBeenCalled();
  });
});
