/**
 * `@developerehsan/api-client/cache-stores` — pluggable persistent cache stores
 * (roadmap E4) and the L1+L2 layering helper. Environment-agnostic: the Redis
 * store takes an injected client (no `redis` dependency) and the IndexedDB store
 * feature-detects `indexedDB`, so this module is safe in any bundle.
 */
import type { CacheEntry } from '../types/cache.types';
import { type PersistentCacheStore, isCacheEntry } from './store.types';

export type { PersistentCacheStore } from './store.types';
export { isCacheEntry } from './store.types';
export { createLayeredCacheStore } from './layered';

/** In-memory persistent store (Map-backed). Handy for tests and SSR warm-up. */
export function createMemoryPersistentStore(): PersistentCacheStore {
  const map = new Map<string, CacheEntry>();
  return {
    get: (key) => Promise.resolve(map.get(key)),
    set: (key, entry) => {
      map.set(key, entry);
      return Promise.resolve();
    },
    delete: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
    clear: () => {
      map.clear();
      return Promise.resolve();
    },
  };
}

/** Options for {@link createIndexedDbStore}. */
export interface IndexedDbStoreOptions {
  /** Database name. @default 'developerehsan-api-cache' */
  dbName?: string;
  /** Object-store name. @default 'responses' */
  storeName?: string;
}

/**
 * A browser IndexedDB-backed persistent store. No-ops (resolving empty) when
 * `indexedDB` is unavailable, so it is safe to construct in any environment.
 */
export function createIndexedDbStore(options: IndexedDbStoreOptions = {}): PersistentCacheStore {
  const dbName = options.dbName ?? 'developerehsan-api-cache';
  const storeName = options.storeName ?? 'responses';
  const idb: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB;

  let dbPromise: Promise<IDBDatabase> | undefined;
  const openDb = (): Promise<IDBDatabase> => {
    if (!idb) return Promise.reject(new Error('indexedDB unavailable'));
    if (!dbPromise) {
      dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const req = idb.open(dbName, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  };

  const tx = <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> =>
    openDb().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const request = run(db.transaction(storeName, mode).objectStore(storeName));
          request.onsuccess = () => resolve(request.result as T);
          request.onerror = () => reject(request.error);
        }),
    );

  const guard = <T>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);

  return {
    get: (key) =>
      guard(
        tx<unknown>('readonly', (s) => s.get(key)).then((v) => (isCacheEntry(v) ? v : undefined)),
        undefined,
      ),
    set: (key, entry) => guard(tx<IDBValidKey>('readwrite', (s) => s.put(entry, key)).then(() => {}), undefined),
    delete: (key) => guard(tx<undefined>('readwrite', (s) => s.delete(key)).then(() => {}), undefined),
    clear: () => guard(tx<undefined>('readwrite', (s) => s.clear()).then(() => {}), undefined),
  };
}

/** The minimal Redis client surface this store needs (node-redis / ioredis compatible). */
export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/** Options for {@link createRedisStore}. */
export interface RedisStoreOptions {
  /** Namespace prepended to every key. @default 'apicache:' */
  keyPrefix?: string;
}

/**
 * A Redis-backed persistent store over an INJECTED client (so `redis`/`ioredis`
 * never becomes a dependency of this package). Entries are JSON-serialized; the
 * per-entry TTL (`expiresAt`) is applied via Redis `PX` so stale entries expire
 * server-side too. `clear()` is a no-op (namespace-wide deletion needs SCAN,
 * which varies by client) — delete keys individually or flush your namespace.
 */
export function createRedisStore(
  client: RedisLikeClient,
  options: RedisStoreOptions = {},
): PersistentCacheStore {
  const prefix = options.keyPrefix ?? 'apicache:';
  const k = (key: string): string => `${prefix}${key}`;
  return {
    async get(key) {
      const raw = await client.get(k(key));
      if (raw === null) return undefined;
      try {
        const parsed: unknown = JSON.parse(raw);
        return isCacheEntry(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    },
    async set(key, entry) {
      const px = Math.max(0, entry.expiresAt - Date.now());
      // PX sets a millisecond TTL so Redis expires the entry in step with our own.
      if (px > 0) await client.set(k(key), JSON.stringify(entry), 'PX', px);
      else await client.set(k(key), JSON.stringify(entry));
    },
    async delete(key) {
      await client.del(k(key));
    },
    async clear() {
      /* namespace-wide clear requires SCAN; left to the caller */
    },
  };
}

