/**
 * At-rest encryption for IndexedDB (spec 08.5): with a fake reversible
 * cipher, stored records are transformed (not plaintext-equal to the
 * original JSON) and read back correctly; without `encrypt`, behavior is
 * unchanged from today.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CacheEntry } from '../types/cache.types';
import { createFakeIndexedDb } from './fakeIndexedDb.test-helper';
import { type CacheCipher, createIndexedDbStore } from './index';

function entry(key: string): CacheEntry {
  return {
    key,
    data: { secret: 'sensitive-value' },
    status: 200,
    headers: {},
    storedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

/** Trivial reversible "cipher" — reverses the string. Good enough to prove the boundary is applied. */
function makeFakeCipher(): CacheCipher {
  return {
    encrypt: (plaintext) => Promise.resolve([...plaintext].reverse().join('')),
    decrypt: (ciphertext) => Promise.resolve([...ciphertext].reverse().join('')),
  };
}

describe('IndexedDB at-rest encryption', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stored records are transformed (not plaintext-equal to the original JSON) and read back correctly', async () => {
    const { factory, db } = createFakeIndexedDb();
    vi.stubGlobal('indexedDB', factory);
    const cipher = makeFakeCipher();
    const store = createIndexedDbStore({ encrypt: cipher });

    const e = entry('a');
    await store.set('a', e);

    const raw = db.store.rows().find((r) => r.key === 'a')?.value;
    expect(JSON.stringify(raw)).not.toContain('sensitive-value');

    const got = await store.get('a');
    expect(got).toEqual(e);
  });

  it('without encrypt configured, behavior is byte-for-byte unchanged (plain JSON on disk)', async () => {
    const { factory, db } = createFakeIndexedDb();
    vi.stubGlobal('indexedDB', factory);
    const store = createIndexedDbStore();

    const e = entry('a');
    await store.set('a', e);

    const raw = db.store.rows().find((r) => r.key === 'a')?.value;
    expect(raw).toEqual(e);

    const got = await store.get('a');
    expect(got).toEqual(e);
  });
});
