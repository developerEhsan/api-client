/**
 * Conditional (ETag) revalidation (spec 08.2): a stored entry's captured
 * `ETag` is sent as `If-None-Match` on the next revalidation fetch; a `304`
 * keeps the previous `data`, just refreshing freshness.
 */
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../testing/createMockClient';
import type { ModuleContext } from '../types/module.types';

function makeThingsClient() {
  const { api, mock } = createMockClient({
    cache: { enabled: true, strategy: 'network-first', ttl: 60_000 },
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
  return { api: api as unknown as { things: { get: (id: string) => Promise<unknown> } }, mock };
}

describe('ETag / conditional requests', () => {
  it('a stored ETag causes the next revalidation to send If-None-Match', async () => {
    const { api, mock } = makeThingsClient();
    mock.on('GET', '/things/1', (r) => {
      const ifNoneMatch = r.headers['If-None-Match'] ?? r.headers['if-none-match'];
      if (ifNoneMatch === 'v1') return { status: 304, headers: { etag: 'v1' } };
      return { status: 200, data: { id: '1', rev: 1 }, headers: { etag: 'v1' } };
    });

    const first = await api.things.get('1');
    expect(first).toEqual({ id: '1', rev: 1 });

    const second = await api.things.get('1');
    expect(second).toEqual({ id: '1', rev: 1 });

    const calls = mock.callsTo('GET', '/things/1');
    expect(calls).toHaveLength(2);
    const secondRequestHeaders = calls[1]?.headers ?? {};
    expect(secondRequestHeaders['If-None-Match'] ?? secondRequestHeaders['if-none-match']).toBe(
      'v1',
    );
  });

  it('a 304 keeps the previous data rather than the (empty) 304 body', async () => {
    const { api, mock } = makeThingsClient();
    let callCount = 0;
    mock.on('GET', '/things/2', () => {
      callCount += 1;
      if (callCount === 1)
        return { status: 200, data: { id: '2', rev: 1 }, headers: { etag: 'abc' } };
      return { status: 304, headers: { etag: 'abc' } }; // no body
    });

    await api.things.get('2');
    const second = await api.things.get('2');
    expect(second).toEqual({ id: '2', rev: 1 });
  });

  it('an entry without a captured ETag behaves exactly as today (no conditional header sent)', async () => {
    const { api, mock } = makeThingsClient();
    mock.on('GET', '/things/3', { status: 200, data: { id: '3' } }); // no etag header

    await api.things.get('3');
    await api.things.get('3');

    const calls = mock.callsTo('GET', '/things/3');
    for (const call of calls) {
      expect(call.headers['If-None-Match'] ?? call.headers['if-none-match']).toBeUndefined();
    }
  });
});
