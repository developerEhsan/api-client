/**
 * `onStoreError` (spec 07): both stores fire it with the right op/key on a
 * backend failure, and the call's own return value is unchanged from
 * today's swallow-and-degrade behavior.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CacheEntry } from '../types/cache.types';
import { createFakeIndexedDb } from './fakeIndexedDb.test-helper';
import { type RedisLikeClient, createIndexedDbStore, createRedisStore } from './index';

function entry(key: string): CacheEntry {
  return { key, data: { key }, status: 200, headers: {}, storedAt: Date.now(), expiresAt: Date.now() + 60_000 };
}

describe('onStoreError — Redis', () => {
  const failingClient: RedisLikeClient = {
    get: () => Promise.reject(new Error('conn refused')),
    set: () => Promise.reject(new Error('conn refused')),
    del: () => Promise.reject(new Error('conn refused')),
  };

  it('fires on get failure with op="get" and the key; get() still resolves undefined', async () => {
    const onStoreError = vi.fn();
    const store = createRedisStore(failingClient, { onStoreError });
    await expect(store.get('k')).resolves.toBeUndefined();
    expect(onStoreError).toHaveBeenCalledWith(expect.any(Error), { op: 'get', key: 'k' });
  });

  it('fires on set failure with op="set" and the key; set() still resolves', async () => {
    const onStoreError = vi.fn();
    const store = createRedisStore(failingClient, { onStoreError });
    await expect(store.set('k', entry('k'))).resolves.toBeUndefined();
    expect(onStoreError).toHaveBeenCalledWith(expect.any(Error), { op: 'set', key: 'k' });
  });

  it('fires on delete failure with op="delete" and the key; delete() still resolves', async () => {
    const onStoreError = vi.fn();
    const store = createRedisStore(failingClient, { onStoreError });
    await expect(store.delete('k')).resolves.toBeUndefined();
    expect(onStoreError).toHaveBeenCalledWith(expect.any(Error), { op: 'delete', key: 'k' });
  });

  it('a throwing onStoreError hook never breaks the store', async () => {
    const store = createRedisStore(failingClient, {
      onStoreError: () => {
        throw new Error('logger boom');
      },
    });
    await expect(store.get('k')).resolves.toBeUndefined();
  });
});

describe('onStoreError — IndexedDB', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires on a backend failure without changing the swallowed return value', async () => {
    const { factory, db } = createFakeIndexedDb();
    vi.stubGlobal('indexedDB', factory);
    vi.spyOn(db.store, 'delete').mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const onStoreError = vi.fn();
    const store = createIndexedDbStore({ onStoreError });
    await expect(store.delete('k')).resolves.toBeUndefined();
    expect(onStoreError).toHaveBeenCalledWith(expect.any(Error), { op: 'delete', key: 'k' });
  });
});
