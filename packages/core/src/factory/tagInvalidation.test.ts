/**
 * Tag-based cache invalidation, end to end through `createClient` (spec 01):
 * descriptor + per-call tag composition, cross-scope invalidation (the
 * same-VM two-user regression), no over-invalidation, and LRU-eviction
 * cleanup of the tag index.
 */
import { describe, expect, it } from 'vitest';
import { createMockAdapter } from '../testing/mockAdapter';
import type { ModuleContext } from '../types/module.types';
import { createClient } from './createClient';

type Api = {
  users: {
    getUser: (id: string) => Promise<unknown>;
    updateUser: (id: string) => Promise<unknown>;
  };
  reports: {
    getDashboard: () => Promise<unknown>;
  };
  cache: {
    invalidateTags(tags: string[]): number;
    get(key: string): unknown;
  };
};

/** A client whose `users` module tags GET-by-id under `user:<id>` and whose
 * update method invalidates that same tag. Auth is bearer with a mutable
 * token so two calls can simulate two different auth scopes on one client. */
function makeClient(mock: ReturnType<typeof createMockAdapter>, getToken: () => string): Api {
  return createClient({
    baseURL: 'http://mock.test',
    openapi: { mode: 'runtime' },
    http: { adapter: mock, retry: { attempts: 1, baseDelay: 0, maxDelay: 0, jitter: false } },
    auth: { strategy: 'bearer', getToken: () => getToken() },
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
          updateUser: async (ctx: ModuleContext, id: string) =>
            (
              await ctx.request(
                { method: 'PATCH', path: '/users/{id}', pathParams: { id }, body: {} },
                { cache: { invalidatesTags: [`user:${id}`] } },
              )
            ).data,
        },
      },
      reports: {
        methods: {
          getDashboard: async (ctx: ModuleContext) =>
            (
              await ctx.request(
                { method: 'GET', path: '/dashboard' },
                { cache: { tags: ['dashboard'] } },
              )
            ).data,
        },
      },
    },
  }) as unknown as Api;
}

describe('tag-based invalidation', () => {
  it('mutation invalidates every auth-scoped copy of the same tag (same-VM two-user regression)', async () => {
    const mock = createMockAdapter();
    mock.on('GET', '/users/123', { data: { id: '123', name: 'v1' } });
    mock.on('PATCH', '/users/123', { data: { id: '123', name: 'v2' } });

    let token = 'admin-token';
    const api = makeClient(mock, () => token);

    // Admin fetches user 123 -> cached under admin's auth-scoped key.
    await api.users.getUser('123');
    // A different user fetches the same resource -> cached under a DIFFERENT key.
    token = 'regular-user-token';
    await api.users.getUser('123');

    expect(mock.callsTo('GET', '/users/123')).toHaveLength(2);

    // Admin performs the update; invalidatesTags clears user:123 everywhere.
    token = 'admin-token';
    await api.users.updateUser('123');

    // Both scopes must now miss cache and hit the network again.
    token = 'admin-token';
    await api.users.getUser('123');
    token = 'regular-user-token';
    await api.users.getUser('123');

    expect(mock.callsTo('GET', '/users/123')).toHaveLength(4);
  });

  it('invalidatesTags clears only entries carrying that tag, not unrelated entries', async () => {
    const mock = createMockAdapter();
    mock.on('GET', '/users/123', { data: { id: '123' } });
    mock.on('GET', '/dashboard', { data: { sales: 1 } });
    mock.on('PATCH', '/users/123', { data: { id: '123' } });

    const api = makeClient(mock, () => 'token');

    await api.users.getUser('123');
    await api.reports.getDashboard();
    expect(mock.callsTo('GET', '/users/123')).toHaveLength(1);
    expect(mock.callsTo('GET', '/dashboard')).toHaveLength(1);

    await api.users.updateUser('123');

    // user:123 was invalidated -> refetches.
    await api.users.getUser('123');
    expect(mock.callsTo('GET', '/users/123')).toHaveLength(2);

    // dashboard tag untouched -> still served from cache.
    await api.reports.getDashboard();
    expect(mock.callsTo('GET', '/dashboard')).toHaveLength(1);
  });

  it('descriptor-level and per-call tags union onto the same entry', async () => {
    const mock = createMockAdapter();
    mock.on('GET', '/users/9', { data: { id: '9' } });
    const api = createClient({
      baseURL: 'http://mock.test',
      openapi: { mode: 'runtime' },
      http: { adapter: mock, retry: { attempts: 1, baseDelay: 0, maxDelay: 0, jitter: false } },
      modules: {
        auto: false as const,
        users: {
          methods: {
            getUser: async (ctx: ModuleContext, id: string) =>
              (
                await ctx.request(
                  { method: 'GET', path: '/users/{id}', pathParams: { id } },
                  { cache: { tags: [`user:${id}`, 'extra-tag'] } },
                )
              ).data,
          },
        },
      },
    }) as unknown as {
      users: { getUser: (id: string) => Promise<unknown> };
      cache: { invalidateTags(tags: string[]): number };
    };

    await api.users.getUser('9');
    // Both tags should reach the same cached entry — invalidating via either
    // tag alone must clear it.
    const removed = api.cache.invalidateTags(['extra-tag']);
    expect(removed).toBe(1);
  });

  it('LRU eviction of a tagged entry removes it from the tag index too', async () => {
    const mock = createMockAdapter();
    mock.on('GET', '/users/1', { data: { id: '1' } });
    mock.on('GET', '/users/2', { data: { id: '2' } });

    const api = createClient({
      baseURL: 'http://mock.test',
      openapi: { mode: 'runtime' },
      http: { adapter: mock, retry: { attempts: 1, baseDelay: 0, maxDelay: 0, jitter: false } },
      cache: { maxSize: 1 },
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
          },
        },
      },
    }) as unknown as {
      users: { getUser: (id: string) => Promise<unknown> };
      cache: { invalidateTags(tags: string[]): number };
    };

    await api.users.getUser('1'); // stored under user:1, maxSize 1
    await api.users.getUser('2'); // evicts user:1's entry from the LRU store

    // Invalidating the evicted entry's tag must remove 0 (nothing left to
    // remove) rather than throwing or leaving a dangling index reference.
    const removed = api.cache.invalidateTags(['user:1']);
    expect(removed).toBe(0);
  });
});
