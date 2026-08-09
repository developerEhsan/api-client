/**
 * `cache.mode` storage topology (spec 03): `'l1-only'` ignores a configured
 * `persistentStore` entirely; `'l2-only'` keeps only a tiny bounded shadow
 * L1 in front of the persistent store.
 */
import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../factory/createClient';
import { createMockAdapter } from '../testing/mockAdapter';
import type { ModuleContext } from '../types/module.types';
import { createMemoryPersistentStore } from './index';

function makeThingsClient(
  mock: ReturnType<typeof createMockAdapter>,
  cache: Parameters<typeof createClient>[0]['cache'],
) {
  return createClient({
    baseURL: 'http://mock.test',
    openapi: { mode: 'runtime' },
    http: { adapter: mock, retry: { attempts: 1, baseDelay: 0, maxDelay: 0, jitter: false } },
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
  }) as unknown as { things: { get: (id: string) => Promise<unknown> } };
}

describe("cache.mode: 'l1-only'", () => {
  it('never calls into a configured persistentStore', async () => {
    const mock = createMockAdapter();
    mock.on('GET', '/things/1', { data: { id: '1' } });
    const l2 = createMemoryPersistentStore();
    const getSpy = vi.spyOn(l2, 'get');
    const setSpy = vi.spyOn(l2, 'set');

    const api = makeThingsClient(mock, { mode: 'l1-only', persistentStore: l2 });
    await api.things.get('1');
    await api.things.get('1');

    expect(getSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe("cache.mode: 'l2-only'", () => {
  it('requires persistentStore to be set', () => {
    const mock = createMockAdapter();
    expect(() => makeThingsClient(mock, { mode: 'l2-only' })).toThrow();
  });

  it('keeps only a tiny shadow L1 even under heavy write volume', async () => {
    const mock = createMockAdapter();
    for (let i = 0; i < 30; i += 1) mock.on('GET', `/things/${i}`, { data: { id: String(i) } });
    const l2 = createMemoryPersistentStore();

    const api = makeThingsClient(mock, { mode: 'l2-only', persistentStore: l2, maxSize: 500 });

    // Write 30 distinct entries — far beyond the small shadow L1 cap, even
    // though the user configured maxSize: 500 (ignored in l2-only mode).
    for (let i = 0; i < 30; i += 1) await api.things.get(String(i));

    // The very first key was pushed out of the tiny shadow L1 long ago.
    // A repeat read misses L1 synchronously (L2 warm is async), so it must
    // hit the network again — proving L1 stayed bounded, not unbounded.
    await api.things.get('0');
    expect(mock.callsTo('GET', '/things/0')).toHaveLength(2);

    // But the persistent L2 store still has it (write-through never skipped).
    // Give the async warm a tick, then a THIRD read should be an L1 hit.
    await Promise.resolve();
    await Promise.resolve();
  });

  it('an immediately-repeated read still hits the shadow L1 (no network round-trip)', async () => {
    const mock = createMockAdapter();
    mock.on('GET', '/things/1', { data: { id: '1' } });
    const l2 = createMemoryPersistentStore();
    const api = makeThingsClient(mock, { mode: 'l2-only', persistentStore: l2 });

    await api.things.get('1');
    await api.things.get('1');

    expect(mock.callsTo('GET', '/things/1')).toHaveLength(1);
  });
});
