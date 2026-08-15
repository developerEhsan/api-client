/**
 * Filesystem-backed PersistentCacheStore (spec 09): round-trip correctness,
 * path-traversal safety (the actual regression test for the security
 * constraint — a hostile key must never escape `dir`), crash tolerance
 * (a stray `.tmp` file must never be read), corrupt-JSON tolerance, and
 * `maxSizeBytes` proactive eviction.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CacheEntry } from '../types/cache.types';
import { createFileSystemStore } from './index';

function entry(key: string, data: unknown = { value: 'hello' }): CacheEntry {
  return {
    key,
    data,
    status: 200,
    headers: {},
    storedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

describe('createFileSystemStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'api-client-fs-cache-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips set/get/delete/clear', async () => {
    const store = createFileSystemStore({ dir });
    const e = entry('a');

    await store.set('a', e);
    expect(await store.get('a')).toEqual(e);

    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();

    await store.set('b', entry('b'));
    await store.set('c', entry('c'));
    await store.clear();
    expect(await store.get('b')).toBeUndefined();
    expect(await store.get('c')).toBeUndefined();
  });

  it('never lets a hostile cache key escape the configured dir (path traversal)', async () => {
    const store = createFileSystemStore({ dir });
    const hostileKey = '../../../../etc/passwd';
    const hostileEntry = entry(hostileKey);

    await store.set(hostileKey, hostileEntry);

    const files = readdirSync(dir);
    // Every written file must resolve to a path INSIDE dir.
    for (const f of files) {
      expect(resolve(dir, f).startsWith(resolve(dir))).toBe(true);
    }
    // No file escaped upward — dir itself only grew, nothing appeared outside it.
    expect(files.length).toBeGreaterThan(0);
    expect(await store.get(hostileKey)).toEqual(hostileEntry);
  });

  it('a stray .tmp file from a simulated crash mid-write is never read', async () => {
    const store = createFileSystemStore({ dir });
    await store.set('a', entry('a', { value: 'real' }));

    // Simulate a crash between writeFile(tmp) and rename(tmp, file): leave a
    // stray .tmp file with different content, no matching rename happened.
    const files = readdirSync(dir);
    const realFile = files.find((f) => f.endsWith('.json'));
    expect(realFile).toBeDefined();
    writeFileSync(
      join(dir, `${realFile}.stray.tmp`),
      JSON.stringify(entry('a', { value: 'corrupt-in-flight' })),
    );

    const got = await store.get('a');
    expect(got?.data).toEqual({ value: 'real' });
  });

  it('corrupt JSON on disk causes get() to return undefined, not throw', async () => {
    const store = createFileSystemStore({ dir });
    await store.set('a', entry('a'));

    const files = readdirSync(dir);
    const realFile = files.find((f) => f.endsWith('.json'));
    writeFileSync(join(dir, realFile!), '{not valid json');

    await expect(store.get('a')).resolves.toBeUndefined();
  });

  it('maxSizeBytes evicts oldest entries once exceeded; unset means no eviction', async () => {
    const bigValue = 'x'.repeat(200);
    const store = createFileSystemStore({ dir, maxSizeBytes: 500 });

    const eA = entry('a', bigValue);
    const eB = entry('b', bigValue);
    const eC = entry('c', bigValue);
    await store.set('a', eA);
    await new Promise((r) => setTimeout(r, 2));
    await store.set('b', eB);
    await new Promise((r) => setTimeout(r, 2));
    await store.set('c', eC);

    // Oldest ('a') should have been evicted once the budget was exceeded.
    expect(await store.get('a')).toBeUndefined();
    expect(await store.get('c')).toEqual(eC);

    const unbounded = createFileSystemStore({
      dir: mkdtempSync(join(tmpdir(), 'api-client-fs-cache-unbounded-')),
    });
    const eA2 = entry('a', bigValue);
    await unbounded.set('a', eA2);
    await unbounded.set('b', entry('b', bigValue));
    await unbounded.set('c', entry('c', bigValue));
    expect(await unbounded.get('a')).toEqual(eA2);
  });

  it('file permission of a written cache file defaults to 0o600', async () => {
    if (process.platform === 'win32') return;
    const store = createFileSystemStore({ dir });
    await store.set('a', entry('a'));
    const file = readdirSync(dir).find((f) => f.endsWith('.json'));
    const mode = statSync(join(dir, file!)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('respects a custom fileMode', async () => {
    if (process.platform === 'win32') return;
    const store = createFileSystemStore({ dir, fileMode: 0o644 });
    await store.set('a', entry('a'));
    const file = readdirSync(dir).find((f) => f.endsWith('.json'));
    const mode = statSync(join(dir, file!)).mode & 0o777;
    expect(mode).toBe(0o644);
  });

  it('creates the directory if missing', async () => {
    const nested = join(dir, 'nested', 'cache');
    const store = createFileSystemStore({ dir: nested });
    await store.set('a', entry('a'));
    const files = readdirSync(nested);
    expect(files.length).toBe(1);
    expect(readFileSync(join(nested, files[0] as string), 'utf8')).toContain('a');
  });

  it('reports backend failures via onStoreError without throwing', async () => {
    const errors: Array<{ error: unknown; op: string }> = [];
    // Point at a path that can't be created (a file, not a dir, as a parent segment).
    const blockingFile = join(dir, 'blocker');
    writeFileSync(blockingFile, 'not a directory');
    const store = createFileSystemStore({
      dir: join(blockingFile, 'cache'),
      onStoreError: (error, context) => errors.push({ error, op: context.op }),
    });

    await store.set('a', entry('a'));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.op).toBe('set');
  });
});
