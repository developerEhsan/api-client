/**
 * IndexedDB store: quota reporting, proactive `maxEntries` eviction, and the
 * generic `onStoreError` hook (spec 07). Uses a minimal fake `IDBFactory`
 * (`fakeIndexedDb.test-helper.ts`) since there's no real browser here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CacheEntry } from '../types/cache.types';
import { createFakeIndexedDb } from './fakeIndexedDb.test-helper';
import { createIndexedDbStore } from './index';

function entry(key: string, storedAt = Date.now()): CacheEntry {
  return { key, data: { key }, status: 200, headers: {}, storedAt, expiresAt: storedAt + 60_000 };
}

describe('createIndexedDbStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('onQuotaExceeded fires on a simulated QuotaExceededError, set() still resolves', async () => {
    const quota = { shouldFail: true };
    const { factory } = createFakeIndexedDb(quota);
    vi.stubGlobal('indexedDB', factory);

    const onQuotaExceeded = vi.fn();
    const store = createIndexedDbStore({ onQuotaExceeded });

    await expect(store.set('a', entry('a'))).resolves.toBeUndefined();
    expect(onQuotaExceeded).toHaveBeenCalledTimes(1);
  });

  it('onQuotaExceeded does not fire on a non-quota failure', async () => {
    const { factory, db } = createFakeIndexedDb();
    vi.stubGlobal('indexedDB', factory);
    // Force a non-quota failure on the next put.
    vi.spyOn(db.store, 'put').mockImplementationOnce(() => {
      throw new Error('disk error');
    });

    const onQuotaExceeded = vi.fn();
    const onStoreError = vi.fn();
    const store = createIndexedDbStore({ onQuotaExceeded, onStoreError });

    await expect(store.set('a', entry('a'))).resolves.toBeUndefined();
    expect(onQuotaExceeded).not.toHaveBeenCalled();
  });

  it('maxEntries proactively evicts the oldest entries once the threshold is reached', async () => {
    const { factory } = createFakeIndexedDb();
    vi.stubGlobal('indexedDB', factory);
    const store = createIndexedDbStore({ maxEntries: 3 });

    await store.set('a', entry('a', 1));
    await store.set('b', entry('b', 2));
    await store.set('c', entry('c', 3));
    // Count is now 3, >= maxEntries: the next set evicts the oldest (a) first.
    await store.set('d', entry('d', 4));

    expect(await store.get('a')).toBeUndefined();
    expect(await store.get('d')).toBeDefined();
  });

  it('onStoreError fires with the right op/key on a backend failure; return value unchanged', async () => {
    const { factory, db } = createFakeIndexedDb();
    vi.stubGlobal('indexedDB', factory);
    vi.spyOn(db.store, 'get').mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const onStoreError = vi.fn();
    const store = createIndexedDbStore({ onStoreError });

    const result = await store.get('missing-or-broken');
    expect(result).toBeUndefined();
    expect(onStoreError).toHaveBeenCalledWith(expect.anything(), { op: 'get', key: 'missing-or-broken' });
  });

  it('no-ops (resolves undefined) when indexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const store = createIndexedDbStore();
    expect(await store.get('a')).toBeUndefined();
    await expect(store.set('a', entry('a'))).resolves.toBeUndefined();
  });
});
