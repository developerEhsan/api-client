/**
 * Cross-instance invalidation (spec 02): a fake in-memory `RedisLikeClient`
 * with a shared pub/sub bus simulates two server processes, each with its
 * own `createRedisStore({ crossInstance: true })` and its own `createClient`.
 */
import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../factory/createClient';
import { createMockAdapter } from '../testing/mockAdapter';
import type { ModuleContext } from '../types/module.types';
import { type RedisLikeClient, createRedisStore } from './index';

/** A shared, synchronous fan-out pub/sub bus backing N fake Redis clients. */
function createFakeRedisBus() {
  const kv = new Map<string, string>();
  const subscribers = new Map<string, Set<(message: string) => void>>();

  function makeClient(): RedisLikeClient {
    return {
      get: (k) => Promise.resolve(kv.get(k) ?? null),
      set: (k, v) => {
        kv.set(k, v);
        return Promise.resolve('OK');
      },
      del: (k) => {
        kv.delete(k);
        return Promise.resolve(1);
      },
      publish: (channel, message) => {
        for (const fn of subscribers.get(channel) ?? []) fn(message);
        return Promise.resolve(1);
      },
      subscribe: (channel, onMessage) => {
        let set = subscribers.get(channel);
        if (!set) {
          set = new Set();
          subscribers.set(channel, set);
        }
        set.add(onMessage);
        return Promise.resolve();
      },
    };
  }

  return {
    makeClient,
    rawPublish: (channel: string, message: string) => {
      for (const fn of subscribers.get(channel) ?? []) fn(message);
    },
  };
}

function makeUsersClient(store: ReturnType<typeof createRedisStore>) {
  const mock = createMockAdapter();
  mock.on('GET', '/users/1', { data: { id: '1' } });
  const api = createClient({
    baseURL: 'http://mock.test',
    openapi: { mode: 'runtime' },
    http: { adapter: mock, retry: { attempts: 1, baseDelay: 0, maxDelay: 0, jitter: false } },
    cache: { persistentStore: store },
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
  return { api, mock };
}

describe('cross-instance invalidation', () => {
  it("instance A invalidating a tag evicts instance B's locally cached entry for that tag", async () => {
    const bus = createFakeRedisBus();
    const storeA = createRedisStore(bus.makeClient(), { crossInstance: true });
    const storeB = createRedisStore(bus.makeClient(), { crossInstance: true });

    const { api: apiA } = makeUsersClient(storeA);
    const { api: apiB, mock: mockB } = makeUsersClient(storeB);

    await apiB.users.getUser('1');
    expect(mockB.callsTo('GET', '/users/1')).toHaveLength(1);

    // Instance A invalidates the tag — B never called invalidateTags itself.
    apiA.cache.invalidateTags(['user:1']);
    // Pub/sub in this fake bus is synchronous, but give the handler a tick.
    await Promise.resolve();

    await apiB.users.getUser('1');
    expect(mockB.callsTo('GET', '/users/1')).toHaveLength(2);
  });

  it('a store never delivers its own published message back to its own handler (echo guard)', async () => {
    const bus = createFakeRedisBus();
    const store = createRedisStore(bus.makeClient(), { crossInstance: true });
    const handler = vi.fn();
    store.onRemoteInvalidate?.(handler);

    await store.publishInvalidate?.({ type: 'tags', values: ['user:1'] });
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
  });

  it("a different instance's publish IS delivered (not just any echo is dropped)", async () => {
    const bus = createFakeRedisBus();
    const storeA = createRedisStore(bus.makeClient(), { crossInstance: true });
    const storeB = createRedisStore(bus.makeClient(), { crossInstance: true });
    const handlerB = vi.fn();
    storeB.onRemoteInvalidate?.(handlerB);

    await storeA.publishInvalidate?.({ type: 'tags', values: ['user:1'] });
    await Promise.resolve();

    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tags', values: ['user:1'] }),
    );
  });

  it('a malformed/oversized incoming message is dropped without throwing or evicting unrelated keys', async () => {
    const bus = createFakeRedisBus();
    const store = createRedisStore(bus.makeClient(), { crossInstance: true });
    const { api, mock } = makeUsersClient(store);

    await api.users.getUser('1');
    expect(mock.callsTo('GET', '/users/1')).toHaveLength(1);

    expect(() => bus.rawPublish('apicache:invalidate', 'not json')).not.toThrow();
    expect(() =>
      bus.rawPublish('apicache:invalidate', JSON.stringify({ type: 'bogus', origin: 'x' })),
    ).not.toThrow();
    expect(() =>
      bus.rawPublish(
        'apicache:invalidate',
        JSON.stringify({
          type: 'tags',
          origin: 'x',
          values: Array.from({ length: 5000 }, () => 'a'),
        }),
      ),
    ).not.toThrow();

    // Unrelated/malformed messages must not have evicted the real entry.
    await api.users.getUser('1');
    expect(mock.callsTo('GET', '/users/1')).toHaveLength(1);
  });

  it('crossInstance: false (default) never calls publish/subscribe', async () => {
    const bus = createFakeRedisBus();
    const client = bus.makeClient();
    const publishSpy = vi.spyOn(client, 'publish');
    const subscribeSpy = vi.spyOn(client, 'subscribe');
    const store = createRedisStore(client);

    expect(store.onRemoteInvalidate).toBeUndefined();
    expect(store.publishInvalidate).toBeUndefined();
    expect(subscribeSpy).not.toHaveBeenCalled();

    await store.set('k', {
      key: 'k',
      data: {},
      status: 200,
      headers: {},
      storedAt: Date.now(),
      expiresAt: Date.now() + 1000,
    });
    await store.delete('k');
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('throws eagerly when crossInstance is requested without publish/subscribe', () => {
    expect(() =>
      createRedisStore(
        { get: async () => null, set: async () => 'OK', del: async () => 1 },
        { crossInstance: true },
      ),
    ).toThrow();
  });
});
