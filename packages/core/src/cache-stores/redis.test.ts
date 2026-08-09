/**
 * Redis store: real `clear()` via `scanKeys`, prefix-safety on delete, and
 * a custom serializer (spec 07).
 */
import { describe, expect, it, vi } from 'vitest';
import type { CacheEntry } from '../types/cache.types';
import { type RedisLikeClient, createRedisStore } from './index';

function entry(key: string): CacheEntry {
  return { key, data: { key }, status: 200, headers: {}, storedAt: Date.now(), expiresAt: Date.now() + 60_000 };
}

function makeClient(store: Map<string, string>): RedisLikeClient {
  return {
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
}

describe('createRedisStore — clear()', () => {
  it('remains a no-op when scanKeys is absent (regression guard)', async () => {
    const store = new Map<string, string>();
    const client = makeClient(store);
    const cache = createRedisStore(client, { keyPrefix: 'app:' });
    store.set('app:a', JSON.stringify(entry('a')));

    await cache.clear();
    expect(store.has('app:a')).toBe(true);
  });

  it('deletes only keys matching this store\'s keyPrefix when scanKeys is supplied', async () => {
    const store = new Map<string, string>();
    store.set('app:a', JSON.stringify(entry('a')));
    store.set('app:b', JSON.stringify(entry('b')));
    store.set('other:c', JSON.stringify(entry('c'))); // different namespace, same Redis instance

    const client = makeClient(store);
    // A buggy/unexpected scanKeys implementation yields a key OUTSIDE the
    // requested prefix too — the store must filter it out, never delete it.
    client.scanKeys = async function* () {
      yield 'app:a';
      yield 'app:b';
      yield 'other:c';
    };

    const cache = createRedisStore(client, { keyPrefix: 'app:' });
    await cache.clear();

    expect(store.has('app:a')).toBe(false);
    expect(store.has('app:b')).toBe(false);
    expect(store.has('other:c')).toBe(true);
  });
});

describe('createRedisStore — custom serializer', () => {
  it('uses the supplied stringify/parse instead of JSON.stringify/parse', async () => {
    const store = new Map<string, string>();
    const client = makeClient(store);
    const stringify = vi.fn((e: CacheEntry) => `custom:${JSON.stringify(e)}`);
    const parse = vi.fn((raw: string) => JSON.parse(raw.replace(/^custom:/, '')) as CacheEntry);

    const cache = createRedisStore(client, { serializer: { stringify, parse } });
    await cache.set('a', entry('a'));
    expect(stringify).toHaveBeenCalled();
    expect(store.get('apicache:a')?.startsWith('custom:')).toBe(true);

    const got = await cache.get('a');
    expect(parse).toHaveBeenCalled();
    expect(got).toMatchObject({ key: 'a' });
  });
});
