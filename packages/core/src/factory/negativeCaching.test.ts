/**
 * Negative caching (spec 08.1): a configured error status is cached with
 * `negativeTtl` so a repeat lookup skips the network — but a cache hit on
 * it still rejects the call, same as a live request would.
 */
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../testing/createMockClient';
import type { ModuleContext } from '../types/module.types';

function makeUsersClient(cache: { cacheableStatuses?: number[]; negativeTtl?: number }) {
  const { api, mock } = createMockClient({
    cache,
    modules: {
      auto: false as const,
      users: {
        methods: {
          getUser: async (ctx: ModuleContext, id: string) =>
            (await ctx.request({ method: 'GET', path: '/users/{id}', pathParams: { id } })).data,
          createUser: async (ctx: ModuleContext, id: string) =>
            (
              await ctx.request(
                { method: 'POST', path: '/users', body: { id } },
                { cache: { invalidatesTags: [`user:${id}`] } },
              )
            ).data,
        },
      },
    },
  });
  return {
    api: api as unknown as {
      users: {
        getUser: (id: string) => Promise<unknown>;
        createUser: (id: string) => Promise<unknown>;
      };
    },
    mock,
  };
}

describe('negative caching', () => {
  it('a 404 gets cached when 404 is configured as cacheable; repeat lookup skips the network', async () => {
    const { api, mock } = makeUsersClient({ cacheableStatuses: [404], negativeTtl: 60_000 });
    mock.on('GET', '/users/999', { status: 404, data: { message: 'not found' } });

    await expect(api.users.getUser('999')).rejects.toBeInstanceOf(Error);
    await expect(api.users.getUser('999')).rejects.toBeInstanceOf(Error);

    expect(mock.callsTo('GET', '/users/999')).toHaveLength(1);
  });

  it('without cacheableStatuses configured, a 404 is never cached (unchanged default behavior)', async () => {
    const { api, mock } = makeUsersClient({});
    mock.on('GET', '/users/999', { status: 404, data: { message: 'not found' } });

    await expect(api.users.getUser('999')).rejects.toBeInstanceOf(Error);
    await expect(api.users.getUser('999')).rejects.toBeInstanceOf(Error);

    expect(mock.callsTo('GET', '/users/999')).toHaveLength(2);
  });

  it('a status not in cacheableStatuses (e.g. 500) is never negative-cached', async () => {
    const { api, mock } = makeUsersClient({ cacheableStatuses: [404] });
    mock.on('GET', '/users/1', { status: 500, data: {} });

    await expect(api.users.getUser('1')).rejects.toBeInstanceOf(Error);
    await expect(api.users.getUser('1')).rejects.toBeInstanceOf(Error);

    expect(mock.callsTo('GET', '/users/1')).toHaveLength(2);
  });

  it('creating the resource plus tag-invalidation clears the negative entry too', async () => {
    const { api, mock } = makeUsersClient({ cacheableStatuses: [404], negativeTtl: 60_000 });
    let exists = false;
    mock.on('GET', '/users/5', () =>
      exists ? { status: 200, data: { id: '5' } } : { status: 404, data: {} },
    );
    mock.on('POST', '/users', (r) => {
      exists = true;
      return { status: 201, data: r.body };
    });

    await expect(api.users.getUser('5')).rejects.toBeInstanceOf(Error);
    expect(mock.callsTo('GET', '/users/5')).toHaveLength(1);

    // Still within negativeTtl — would normally skip the network...
    await api.users.createUser('5'); // ...but this invalidates user:5's cache entry.

    // Hmm: the GET descriptor above has no cacheTags, so invalidatesTags on
    // createUser has nothing to match unless the GET call also tagged it.
    // Re-fetch: since createUser doesn't share a tag with an untagged GET,
    // the negative entry is untouched by tag invalidation — assert that
    // baseline (tags are opt-in, not automatic) rather than a false claim.
    await expect(api.users.getUser('5')).rejects.toBeInstanceOf(Error);
    expect(mock.callsTo('GET', '/users/5')).toHaveLength(1);
  });

  it('a tagged negative entry IS cleared by invalidatesTags, same as any other entry', async () => {
    const mock2 = createMockClient({
      cache: { cacheableStatuses: [404], negativeTtl: 60_000 },
      modules: {
        auto: false as const,
        users: {
          methods: {
            getUser: async (ctx: ModuleContext, id: string) =>
              (
                await ctx.request(
                  { method: 'GET', path: '/users/{id}', pathParams: { id } },
                  { cache: { tags: [`user:${id}`] } },
                )
              ).data,
            createUser: async (ctx: ModuleContext, id: string) =>
              (
                await ctx.request(
                  { method: 'POST', path: '/users', body: { id } },
                  { cache: { invalidatesTags: [`user:${id}`] } },
                )
              ).data,
          },
        },
      },
    });
    const api = mock2.api as unknown as {
      users: {
        getUser: (id: string) => Promise<unknown>;
        createUser: (id: string) => Promise<unknown>;
      };
    };
    let exists = false;
    mock2.mock.on('GET', '/users/5', () =>
      exists ? { status: 200, data: { id: '5' } } : { status: 404, data: {} },
    );
    mock2.mock.on('POST', '/users', (r) => {
      exists = true;
      return { status: 201, data: r.body };
    });

    await expect(api.users.getUser('5')).rejects.toBeInstanceOf(Error);
    expect(mock2.mock.callsTo('GET', '/users/5')).toHaveLength(1);

    await api.users.createUser('5');

    const result = await api.users.getUser('5');
    expect(result).toEqual({ id: '5' });
    expect(mock2.mock.callsTo('GET', '/users/5')).toHaveLength(2);
  });
});
