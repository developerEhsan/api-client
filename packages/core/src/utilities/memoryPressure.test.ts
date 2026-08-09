/**
 * Node-only, opt-in proactive eviction ahead of RSS pressure (spec 03).
 * Feature-detected via `process.memoryUsage` so it safely no-ops on edge/
 * browser runtimes that lack it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../factory/createClient';
import { createMockAdapter } from '../testing/mockAdapter';
import type { ModuleContext } from '../types/module.types';

function makeThingsClient(mock: ReturnType<typeof createMockAdapter>, cache: unknown) {
  return createClient({
    baseURL: 'http://mock.test',
    openapi: { mode: 'runtime' },
    http: {
      adapter: mock,
      retry: { attempts: 1, baseDelay: 0, maxDelay: 0, jitter: false },
    },
    cache: cache as never,
    modules: {
      auto: false as const,
      things: {
        methods: {
          get: async (ctx: ModuleContext, id: string) =>
            (
              await ctx.request({
                method: 'GET',
                path: '/things/{id}',
                pathParams: { id },
              })
            ).data,
        },
      },
    },
  }) as unknown as { things: { get: (id: string) => Promise<unknown> } };
}

describe('memoryPressure', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('evicts once the RSS threshold is crossed, and not before', async () => {
    vi.useFakeTimers();
    let rssBytes = 10 * 1024 * 1024; // 10MB — under the 50MB threshold
    vi.stubGlobal('process', {
      ...process,
      memoryUsage: () => ({ rss: rssBytes }) as NodeJS.MemoryUsage,
    });

    const evicted: string[] = [];
    const mock = createMockAdapter();
    mock.on('GET', '/things/1', { data: { id: '1' } });
    const api = makeThingsClient(mock, {
      onEvict: (k: string) => evicted.push(k),
      memoryPressure: { thresholdMb: 50, checkIntervalMs: 1000 },
    });

    await api.things.get('1');

    // Under threshold: the periodic check must not evict.
    await vi.advanceTimersByTimeAsync(1000);
    expect(evicted).toHaveLength(0);

    // Cross the threshold: the next tick must evict.
    rssBytes = 100 * 1024 * 1024;
    await vi.advanceTimersByTimeAsync(1000);
    expect(evicted).toHaveLength(1);
  });

  it('no-ops when process.memoryUsage is undefined (simulated edge runtime)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('process', undefined);

    const mock = createMockAdapter();
    mock.on('GET', '/things/1', { data: { id: '1' } });

    expect(() =>
      makeThingsClient(mock, {
        memoryPressure: { thresholdMb: 1, checkIntervalMs: 1000 },
      }),
    ).not.toThrow();

    await vi.advanceTimersByTimeAsync(5000);
    // No crash, no timer-driven work — nothing to assert beyond "didn't throw".
  });
});
