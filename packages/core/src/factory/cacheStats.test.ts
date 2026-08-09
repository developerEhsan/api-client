/**
 * `client.cache.getStats()` (spec 08.3): pure aggregation of the existing
 * `onCacheHit`/`onCacheMiss` firings, across cache-first, network-first, and
 * stale-while-revalidate.
 */
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../testing/createMockClient';
import type { ModuleContext } from '../types/module.types';

function makeThingsClient(cache: { strategy?: 'cache-first' | 'network-first' | 'stale-while-revalidate'; ttl?: number }) {
  const { api, mock } = createMockClient({
    cache,
    modules: {
      auto: false as const,
      things: {
        methods: {
          get: async (ctx: ModuleContext, id: string) =>
            (await ctx.request({ method: 'GET', path: '/things/{id}', pathParams: { id } })).data,
        },
      },
    },
  });
  return {
    api: api as unknown as {
      things: { get: (id: string) => Promise<unknown> };
      cache: { getStats(): { hits: number; misses: number; size: number; hitRate: number } };
    },
    mock,
  };
}

describe('client.cache.getStats()', () => {
  it('hitRate is 0 at 0 requests (no division by zero)', () => {
    const { api } = makeThingsClient({});
    expect(api.cache.getStats()).toEqual({ hits: 0, misses: 0, size: 0, hitRate: 0 });
  });

  it('cache-first: first call is a miss, second (fresh) call is a hit', async () => {
    const { api, mock } = makeThingsClient({ strategy: 'cache-first', ttl: 60_000 });
    mock.on('GET', '/things/1', { data: { id: '1' } });

    await api.things.get('1');
    let stats = api.cache.getStats();
    expect(stats).toMatchObject({ hits: 0, misses: 1 });

    await api.things.get('1');
    stats = api.cache.getStats();
    expect(stats).toMatchObject({ hits: 1, misses: 1, hitRate: 0.5 });
  });

  it('network-first: a fallback-to-cache hit still increments hits', async () => {
    const { api, mock } = makeThingsClient({ strategy: 'network-first', ttl: 60_000 });
    let fail = false;
    mock.on('GET', '/things/2', () => {
      if (fail) throw new Error('network down');
      return { data: { id: '2' } };
    });

    await api.things.get('2'); // populates cache (network-first's success path doesn't emit a miss)
    fail = true;
    await api.things.get('2'); // network fails, falls back to cache -> hit

    const stats = api.cache.getStats();
    expect(stats.hits).toBe(1);
  });

  it('stale-while-revalidate: a stale hit still counts as a hit', async () => {
    const { api, mock } = makeThingsClient({ strategy: 'stale-while-revalidate', ttl: 1 });
    mock.on('GET', '/things/3', { data: { id: '3' } });

    await api.things.get('3'); // miss
    await new Promise((r) => setTimeout(r, 5)); // let the entry go stale
    await api.things.get('3'); // stale hit (served immediately, revalidates in background)

    const stats = api.cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });
});
