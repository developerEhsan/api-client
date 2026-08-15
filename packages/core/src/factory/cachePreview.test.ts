/**
 * `client.cache.preview(pattern)` (spec 08.8): a read-only dry run for
 * pattern-based invalidation, so a typo'd glob can be checked before it
 * wipes more than intended.
 */
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../testing/createMockClient';
import type { ModuleContext } from '../types/module.types';

describe('client.cache.preview()', () => {
  it('returns the same keys invalidate(pattern) would remove, without removing them', async () => {
    const { api, mock } = createMockClient({
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
    const typedApi = api as unknown as {
      things: { get: (id: string) => Promise<unknown> };
      cache: { preview(pattern: string): string[]; invalidate(pattern?: string): void };
    };
    mock.on('GET', '/things/1', { data: { id: '1' } });
    mock.on('GET', '/things/2', { data: { id: '2' } });

    await typedApi.things.get('1');
    await typedApi.things.get('2');

    const preview = typedApi.cache.preview('GET:*/things/1*');
    expect(preview.length).toBeGreaterThan(0);

    // Nothing removed yet: both are still served from cache (no extra network calls).
    await typedApi.things.get('1');
    await typedApi.things.get('2');
    expect(mock.callsTo('GET', '/things/1')).toHaveLength(1);
    expect(mock.callsTo('GET', '/things/2')).toHaveLength(1);

    // Now actually invalidate the previewed pattern.
    typedApi.cache.invalidate('GET:*/things/1*');
    await typedApi.things.get('1');
    await typedApi.things.get('2');
    expect(mock.callsTo('GET', '/things/1')).toHaveLength(2); // evicted -> refetched
    expect(mock.callsTo('GET', '/things/2')).toHaveLength(1); // untouched
  });
});
