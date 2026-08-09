/**
 * Schema-version cache busting (spec 08.7): a cached entry written under one
 * runtime schema hash is treated as a miss once the client's active hash
 * changes (e.g. after a deploy), rather than serving old-shaped data.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from './createClient';
import { createMockAdapter } from '../testing/mockAdapter';
import type { ModuleContext } from '../types/module.types';

const docV1 = { openapi: '3.0.0', info: { title: 'x', version: '1' }, paths: {} };
const docV2 = { openapi: '3.0.0', info: { title: 'x', version: '2' }, paths: {} };

function makeClient(mock: ReturnType<typeof createMockAdapter>, currentDoc: () => unknown) {
  vi.stubGlobal('fetch', (url: string) => {
    if (url === 'http://schema.test/openapi.json') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(currentDoc()),
      } as Response);
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });

  return createClient({
    baseURL: 'http://mock.test',
    openapi: { mode: 'runtime', runtimeURL: 'http://schema.test/openapi.json' },
    http: { adapter: mock, retry: { attempts: 1, baseDelay: 0, maxDelay: 0, jitter: false } },
    dev: { schemaRefreshInterval: 20 },
    cache: { strategy: 'cache-first', ttl: 60_000 },
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

describe('schema-version cache busting', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('an entry written under schema hash A is treated as a miss once the active hash becomes B', async () => {
    const mock = createMockAdapter();
    mock.on('GET', '/things/1', { data: { id: '1' } });

    let current: unknown = docV1;
    const api = makeClient(mock, () => current);

    // Let the initial background schema load settle.
    await new Promise((r) => setTimeout(r, 10));

    await api.things.get('1');
    expect(mock.callsTo('GET', '/things/1')).toHaveLength(1);

    // Still schema A, within TTL -> served from cache, no network call.
    await api.things.get('1');
    expect(mock.callsTo('GET', '/things/1')).toHaveLength(1);

    // Deploy: the schema changes. Let the poll pick it up.
    current = docV2;
    await new Promise((r) => setTimeout(r, 40));

    // Same cache key, but the schema hash no longer matches -> miss, refetch.
    await api.things.get('1');
    expect(mock.callsTo('GET', '/things/1')).toHaveLength(2);
  });

  it('an unchanged schema hash behaves exactly as today (cache hit, no refetch)', async () => {
    const mock = createMockAdapter();
    mock.on('GET', '/things/1', { data: { id: '1' } });

    const api = makeClient(mock, () => docV1);
    await new Promise((r) => setTimeout(r, 10));

    await api.things.get('1');
    await new Promise((r) => setTimeout(r, 40)); // polls fire but the doc never changes
    await api.things.get('1');

    expect(mock.callsTo('GET', '/things/1')).toHaveLength(1);
  });
});
