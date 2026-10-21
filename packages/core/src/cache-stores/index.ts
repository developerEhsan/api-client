/**
 * `@developerehsan/api-client/cache-stores` — pluggable persistent cache stores
 * (roadmap E4) and the L1+L2 layering helper. Environment-agnostic: the Redis
 * store takes an injected client (no `redis` dependency) and the IndexedDB store
 * feature-detects `indexedDB`, so this module is safe in any bundle.
 */
import * as nodeCrypto from 'node:crypto';
import * as nodeFs from 'node:fs/promises';
import * as nodePath from 'node:path';
import { ConfigurationError } from '../errors/ConfigurationError';
import type { CacheEntry } from '../types/cache.types';
import {
  type InvalidationMessage,
  type OutgoingInvalidationMessage,
  type PersistentCacheStore,
  isCacheEntry,
} from './store.types';

export type {
  InvalidationMessage,
  OutgoingInvalidationMessage,
  PersistentCacheStore,
} from './store.types';
export { isCacheEntry } from './store.types';
export { createLayeredCacheStore } from './layered';
export type { LayeredCacheStoreOptions, LayeredStoreErrorHandler } from './layered';

/** Defensive caps on an incoming pub/sub payload (spec 02: never trust the wire). */
const MAX_INVALIDATION_VALUES = 1000;
const MAX_INVALIDATION_VALUE_LENGTH = 500;

/**
 * Parse+validate a raw pub/sub message into an {@link InvalidationMessage}.
 * Returns `undefined` for anything malformed or oversized — the caller drops
 * it silently rather than throwing (mirrors "L2 errors never break a
 * request" in `layered.ts`).
 */
function parseInvalidationMessage(raw: string): InvalidationMessage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const msg = parsed as Record<string, unknown>;
  if (msg['type'] !== 'tags' && msg['type'] !== 'keys' && msg['type'] !== 'clear') {
    return undefined;
  }
  if (typeof msg['origin'] !== 'string') return undefined;
  let values: string[] | undefined;
  if (msg['values'] !== undefined) {
    if (!Array.isArray(msg['values']) || msg['values'].length > MAX_INVALIDATION_VALUES) {
      return undefined;
    }
    if (
      !msg['values'].every(
        (v): v is string => typeof v === 'string' && v.length <= MAX_INVALIDATION_VALUE_LENGTH,
      )
    ) {
      return undefined;
    }
    values = msg['values'];
  }
  return { type: msg['type'], origin: msg['origin'], ...(values ? { values } : {}) };
}

/**
 * In-memory persistent store (Map-backed). Handy for tests and SSR warm-up.
 *
 * @example
 * import { createClient } from '@developerehsan/api-client'
 * import { createMemoryPersistentStore } from '@developerehsan/api-client/cache-stores'
 *
 * const api = createClient({
 *   baseURL, openapi: { mode: 'runtime' },
 *   cache: { persistentStore: createMemoryPersistentStore() },
 * })
 */
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

/** Backend operation a {@link StoreErrorHandler} fired for. */
export type StoreErrorContext = { op: 'get' | 'set' | 'delete' | 'clear'; key?: string };

/**
 * Diagnostic hook fired on a backend failure, in ADDITION to (never instead
 * of) the store's existing swallow-and-degrade behavior — the call's return
 * value is unchanged either way. Carries the error and operation context
 * only, never the cache entry's `data` (spec 07: not a second channel for
 * cached response bodies to leak through logging).
 */
export type StoreErrorHandler = (error: unknown, context: StoreErrorContext) => void;

const STORE_ERROR_NAME = 'QuotaExceededError';

/** True for a DOM `QuotaExceededError` (by `name`, the standard DOM exception field). */
function isQuotaExceededError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === STORE_ERROR_NAME
  );
}

/** Options for {@link createIndexedDbStore}. */
export interface IndexedDbStoreOptions {
  /** Database name. @default 'developerehsan-api-cache' */
  dbName?: string;
  /** Object-store name. @default 'responses' */
  storeName?: string;
  /**
   * IndexedDB schema version. Bump when changing `storeName` or otherwise
   * needing a migration.
   * @default 1
   */
  version?: number;
  /**
   * Called when a `set()` fails specifically due to storage quota
   * (`QuotaExceededError`). Default behavior (unset): swallow, same as
   * every other write failure. `set()` still resolves either way — this is
   * a diagnostic hook, not a way to turn a swallowed failure into a thrown one.
   */
  onQuotaExceeded?: (error: unknown) => void;
  /**
   * When set, `set()` proactively evicts the oldest ~10% of entries (by
   * `storedAt`) before writing, once total entry count reaches this — a
   * coarse client-side LRU, since IndexedDB itself enforces none.
   * @default optional, unset means no proactive eviction
   */
  maxEntries?: number;
  /** Fires on any backend failure across get/set/delete/clear. See {@link StoreErrorHandler}. */
  onStoreError?: StoreErrorHandler;
  /**
   * At-rest encryption for entries persisted to IndexedDB (spec 08.5). No
   * default cipher/key management is shipped — key handling (where the key
   * comes from, whether it survives a reload) is inherently
   * application-specific. This protects against casual inspection of
   * browser storage; it does NOT protect against the page's own JS, which
   * by definition can call `decrypt` itself.
   * @default optional, unset means entries are stored as plain JSON (today's behavior)
   */
  encrypt?: CacheCipher;
  /**
   * Broadcast local invalidations to other tabs of the same origin over
   * `BroadcastChannel`, and apply theirs locally — the browser-side
   * counterpart to the Redis store's `crossInstance` (#46).
   *
   * Without it a mutation in one tab leaves every other open tab serving the
   * stale cached GET until its TTL expires.
   *
   * No-ops where `BroadcastChannel` is unavailable.
   *
   * @default false
   * @example `createIndexedDbStore({ crossTab: true })`
   */
  crossTab?: boolean;
  /**
   * `BroadcastChannel` name used when `crossTab` is on. Change it to isolate
   * two independent caches sharing one origin.
   * @default 'apicache:invalidate'
   * @example `createIndexedDbStore({ crossTab: true, channel: 'admin-cache' })`
   */
  channel?: string;
}

/** Pluggable cipher for {@link IndexedDbStoreOptions.encrypt}. See its security note. */
export interface CacheCipher {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

/** On-disk wrapper for an encrypted entry, distinguishing it from a plain stored `CacheEntry`. */
interface EncryptedRecord {
  __apiClientEncrypted: true;
  payload: string;
}

function isEncryptedRecord(value: unknown): value is EncryptedRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __apiClientEncrypted?: unknown }).__apiClientEncrypted === true &&
    typeof (value as { payload?: unknown }).payload === 'string'
  );
}

const STORED_AT_INDEX = 'storedAt';

/**
 * A browser IndexedDB-backed persistent store. No-ops (resolving empty) when
 * `indexedDB` is unavailable, so it is safe to construct in any environment.
 *
 * @example
 * import { createIndexedDbStore } from '@developerehsan/api-client/cache-stores'
 *
 * const api = createClient({
 *   baseURL, openapi: { mode: 'runtime' },
 *   // GET responses survive reloads; warmed into the in-memory L1 on demand.
 *   cache: { persistentStore: createIndexedDbStore({ dbName: 'my-app-cache' }) },
 * })
 */
export function createIndexedDbStore(options: IndexedDbStoreOptions = {}): PersistentCacheStore {
  const dbName = options.dbName ?? 'developerehsan-api-cache';
  const storeName = options.storeName ?? 'responses';
  const version = options.version ?? 1;
  const idb: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB;

  let dbPromise: Promise<IDBDatabase> | undefined;
  const openDb = (): Promise<IDBDatabase> => {
    if (!idb) return Promise.reject(new Error('indexedDB unavailable'));
    if (!dbPromise) {
      dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const req = idb.open(dbName, version);
        req.onupgradeneeded = () => {
          const store = req.result.objectStoreNames.contains(storeName)
            ? req.transaction?.objectStore(storeName)
            : req.result.createObjectStore(storeName);
          if (store && !store.indexNames.contains(STORED_AT_INDEX)) {
            store.createIndex(STORED_AT_INDEX, STORED_AT_INDEX, { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  };

  const tx = <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> =>
    openDb().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const request = run(db.transaction(storeName, mode).objectStore(storeName));
          request.onsuccess = () => resolve(request.result as T);
          request.onerror = () => reject(request.error);
        }),
    );

  const report = (error: unknown, context: StoreErrorContext): void => {
    try {
      options.onStoreError?.(error, context);
    } catch {
      /* a reporting hook must never break the store */
    }
  };

  const guard = <T>(p: Promise<T>, fallback: T, context: StoreErrorContext): Promise<T> =>
    p.catch((error: unknown) => {
      report(error, context);
      return fallback;
    });

  /** Delete the oldest ~10% of entries by `storedAt`, via the cursor index. */
  const evictOldest = (maxEntries: number): Promise<void> =>
    openDb().then(
      (db) =>
        new Promise<void>((resolve) => {
          const store = db.transaction(storeName, 'readwrite').objectStore(storeName);
          const countReq = store.count();
          countReq.onsuccess = () => {
            if (countReq.result < maxEntries) return resolve();
            const toEvict = Math.max(1, Math.ceil(maxEntries * 0.1));
            let evicted = 0;
            const cursorReq = store.index(STORED_AT_INDEX).openCursor();
            cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (!cursor || evicted >= toEvict) return resolve();
              cursor.delete();
              evicted += 1;
              cursor.continue();
            };
            cursorReq.onerror = () => resolve();
          };
          countReq.onerror = () => resolve();
        }),
    );

  const store: PersistentCacheStore = {
    get: (key) =>
      guard(
        tx<unknown>('readonly', (s) => s.get(key)).then(async (v) => {
          if (isCacheEntry(v)) return v;
          if (options.encrypt && isEncryptedRecord(v)) {
            const decrypted = await options.encrypt.decrypt(v.payload);
            const parsed: unknown = JSON.parse(decrypted);
            return isCacheEntry(parsed) ? parsed : undefined;
          }
          return undefined;
        }),
        undefined,
        { op: 'get', key },
      ),
    set: async (key, entry) => {
      if (options.maxEntries !== undefined) await evictOldest(options.maxEntries);
      const record: unknown = options.encrypt
        ? ({
            __apiClientEncrypted: true,
            payload: await options.encrypt.encrypt(JSON.stringify(entry)),
          } satisfies EncryptedRecord)
        : entry;
      return tx<IDBValidKey>('readwrite', (s) => s.put(record, key))
        .then(() => undefined)
        .catch((error: unknown) => {
          if (isQuotaExceededError(error)) options.onQuotaExceeded?.(error);
          report(error, { op: 'set', key });
          return undefined;
        });
    },
    delete: (key) =>
      guard(
        tx<undefined>('readwrite', (s) => s.delete(key)).then(() => undefined),
        undefined,
        { op: 'delete', key },
      ),
    clear: () =>
      guard(
        tx<undefined>('readwrite', (s) => s.clear()).then(() => undefined),
        undefined,
        { op: 'clear' },
      ),
  };

  if (!options.crossTab) return store;

  interface BroadcastChannelLike {
    postMessage(data: unknown): void;
    onmessage: ((ev: { data: unknown }) => void) | null;
  }
  const BC = (globalThis as { BroadcastChannel?: new (name: string) => BroadcastChannelLike })
    .BroadcastChannel;
  // Same contract as every other capability here: an unavailable backend
  // degrades to the plain store rather than throwing at construction.
  if (!BC) return store;

  const channelName = options.channel ?? 'apicache:invalidate';
  const origin = randomOrigin();
  const handlers = new Set<(msg: InvalidationMessage) => void>();
  let channel: BroadcastChannelLike;
  try {
    channel = new BC(channelName);
  } catch {
    return store;
  }

  channel.onmessage = (ev) => {
    // Payload comes from a sibling tab, so it is parsed through the same
    // validator as the Redis path rather than trusted as-is.
    const msg = parseInvalidationMessage(
      typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data),
    );
    if (!msg || msg.origin === origin) return;
    for (const handler of handlers) handler(msg);
  };

  return {
    ...store,
    onRemoteInvalidate(handler) {
      handlers.add(handler);
    },
    publishInvalidate(msg: OutgoingInvalidationMessage) {
      try {
        channel.postMessage(JSON.stringify({ ...msg, origin }));
      } catch {
        // Fire-and-forget: a closed channel must never fail a request.
      }
      return Promise.resolve();
    },
  };
}

/** Options for {@link createFileSystemStore}. */
export interface FileSystemStoreOptions {
  /** Directory to store cache files in. Created if missing. @default './.api-client-cache' */
  dir?: string;
  /**
   * Max total bytes the cache directory may hold before proactive eviction
   * (oldest `storedAt` first, tracked via an in-memory index built lazily on
   * first write/read). Unset means no proactive size cap.
   * @default optional, unset means no proactive eviction
   */
  maxSizeBytes?: number;
  /** File permission mode for written cache files. @default 0o600 (owner read/write only) */
  fileMode?: number;
  /** Fires on any backend failure across get/set/delete/clear. See {@link StoreErrorHandler}. */
  onStoreError?: StoreErrorHandler;
  /**
   * At-rest encryption for entries persisted to disk (spec 08.5 / 09), same
   * interface as {@link IndexedDbStoreOptions.encrypt}. No default cipher is
   * shipped.
   * @default optional, unset means entries are stored as plain JSON
   */
  encrypt?: CacheCipher;
}

/**
 * A Node-only, disk-backed persistent store — trades RAM for disk on a
 * long-running server process (the Next.js data-cache / nginx `proxy_cache`
 * shape). Resolves to a safe no-op store (never throws at construction time)
 * when `node:fs`/`node:crypto` aren't usable, e.g. accidentally constructed
 * in a browser bundle.
 *
 * Does NOT fit serverless/edge (filesystem is ephemeral/absent there) and
 * does NOT solve cross-instance staleness (each instance has its own disk —
 * use Redis `crossInstance` for that, or `docs/cache-persistence.md`). Do
 * not point `dir` at a network filesystem (NFS/EFS) as a cross-instance
 * workaround — that reintroduces coordination with worse latency/locking
 * semantics than Redis already gives you.
 *
 * Cache keys are never used as path segments directly — every key is
 * SHA-256 hashed into a fixed-length hex filename, so no cache key (however
 * derived — a custom `keyResolver`, `cacheKeyParts`, etc.) can ever cause
 * path traversal or reach an unintended file.
 *
 * @example
 * import { createFileSystemStore } from '@developerehsan/api-client/cache-stores'
 *
 * const api = createClient({
 *   baseURL, openapi: { mode: 'runtime' },
 *   cache: { persistentStore: createFileSystemStore({ dir: '/var/cache/my-app' }) },
 * })
 */
export function createFileSystemStore(options: FileSystemStoreOptions = {}): PersistentCacheStore {
  const dir = options.dir ?? './.api-client-cache';
  const fileMode = options.fileMode ?? 0o600;
  const maxSizeBytes = options.maxSizeBytes;

  const report = (error: unknown, context: StoreErrorContext): void => {
    try {
      options.onStoreError?.(error, context);
    } catch {
      /* a reporting hook must never break the store */
    }
  };

  // `cache-stores` is its own bundle entry (tsup.config.ts), never pulled
  // into the `/browser` subpath export — so importing `node:fs`/`node:crypto`
  // statically at module scope is safe. Still feature-detect at construction
  // time (never throw) in case this module is somehow loaded where those
  // APIs are stubbed out to non-functional shims.
  const fs = nodeFs;
  const path = nodePath;
  const crypto = nodeCrypto;
  const nodeApisUsable =
    typeof fs.mkdir === 'function' &&
    typeof fs.writeFile === 'function' &&
    typeof crypto.createHash === 'function';

  if (!nodeApisUsable) {
    // Safe no-op — never throws at construction time.
    const noop: PersistentCacheStore = {
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    return noop;
  }

  const keyToFilename = (key: string): string =>
    `${crypto.createHash('sha256').update(key).digest('hex')}.json`;

  let dirReady: Promise<void> | undefined;
  const ensureDir = (): Promise<void> => {
    if (!dirReady) dirReady = fs.mkdir(dir, { recursive: true }).then(() => undefined);
    return dirReady;
  };

  let randomSuffixCounter = 0;
  const randomSuffix = (): string => {
    randomSuffixCounter += 1;
    return `${process.pid}-${randomSuffixCounter}-${crypto.randomBytes(4).toString('hex')}`;
  };

  // Lazy in-memory size index for maxSizeBytes eviction (spec 09, approach a):
  // built incrementally as entries are written, never a directory-wide scan.
  const sizeIndex = new Map<string, { size: number; storedAt: number }>();
  let totalBytes = 0;

  const evictIfOverBudget = async (): Promise<void> => {
    if (maxSizeBytes === undefined) return;
    if (totalBytes <= maxSizeBytes) return;
    const sorted = [...sizeIndex.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt);
    for (const [key, meta] of sorted) {
      if (totalBytes <= maxSizeBytes) break;
      sizeIndex.delete(key);
      totalBytes -= meta.size;
      await fs.unlink(path.join(dir, keyToFilename(key))).catch(() => undefined);
    }
  };

  return {
    async get(key) {
      try {
        const raw = await fs.readFile(path.join(dir, keyToFilename(key)), 'utf8');
        const parsed: unknown = JSON.parse(raw);
        if (options.encrypt && isEncryptedRecord(parsed)) {
          const decrypted = await options.encrypt.decrypt(parsed.payload);
          const inner: unknown = JSON.parse(decrypted);
          return isCacheEntry(inner) ? inner : undefined;
        }
        return isCacheEntry(parsed) ? parsed : undefined;
      } catch {
        // ENOENT, corrupt JSON, permission error — all treated as a miss.
        return undefined;
      }
    },
    async set(key, entry) {
      try {
        await ensureDir();
        const record: unknown = options.encrypt
          ? ({
              __apiClientEncrypted: true,
              payload: await options.encrypt.encrypt(JSON.stringify(entry)),
            } satisfies EncryptedRecord)
          : entry;
        const serialized = JSON.stringify(record);
        const file = path.join(dir, keyToFilename(key));
        const tmp = `${file}.${randomSuffix()}.tmp`;
        await fs.writeFile(tmp, serialized, { mode: fileMode });
        await fs.rename(tmp, file);
        if (maxSizeBytes !== undefined) {
          const size = Buffer.byteLength(serialized);
          const prev = sizeIndex.get(key);
          if (prev) totalBytes -= prev.size;
          sizeIndex.set(key, { size, storedAt: entry.storedAt });
          totalBytes += size;
          await evictIfOverBudget();
        }
      } catch (error) {
        report(error, { op: 'set', key });
      }
    },
    async delete(key) {
      try {
        const prev = sizeIndex.get(key);
        if (prev) {
          sizeIndex.delete(key);
          totalBytes -= prev.size;
        }
        await fs.unlink(path.join(dir, keyToFilename(key)));
      } catch (error) {
        // ENOENT (already gone) isn't a real failure — only report others.
        if ((error as { code?: string } | null)?.code !== 'ENOENT') {
          report(error, { op: 'delete', key });
        }
      }
    },
    async clear() {
      try {
        sizeIndex.clear();
        totalBytes = 0;
        const files = await fs.readdir(dir).catch(() => [] as string[]);
        await Promise.all(files.map((f) => fs.unlink(path.join(dir, f)).catch(() => undefined)));
      } catch (error) {
        report(error, { op: 'clear' });
      }
    },
  };
}

/** The minimal Redis client surface this store needs (node-redis / ioredis compatible). */
export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
  /** Optional: required only when `crossInstance` invalidation is enabled. */
  publish?(channel: string, message: string): Promise<unknown>;
  /**
   * Optional: required only when `crossInstance` invalidation is enabled.
   * Most Redis clients (node-redis, ioredis) require a DEDICATED connection
   * for subscribe mode — pass a second client instance here, not the one
   * used for get/set/del.
   */
  subscribe?(channel: string, onMessage: (message: string) => void): Promise<unknown>;
  /**
   * Optional: enables a real namespace-wide `clear()` via SCAN+DEL instead
   * of the default no-op. Most node-redis/ioredis clients expose scanning
   * as `scanIterator`/`scanStream` under a different shape — pass a thin
   * adapter over whichever your client provides.
   */
  scanKeys?(matchPattern: string): AsyncIterable<string>;
}

/** Custom (de)serializer for {@link createRedisStore}. See its security note on `parse`. */
export interface RedisEntrySerializer {
  stringify(entry: CacheEntry): string;
  /**
   * Parse a raw stored value back into a {@link CacheEntry}, or `undefined`
   * if it doesn't look like one. MUST be a safe structured-data parse
   * (`JSON.parse` or equivalent) — never `eval`/`Function`-based
   * deserialization of data read back from Redis.
   */
  parse(raw: string): CacheEntry | undefined;
}

/** Options for {@link createRedisStore}. */
export interface RedisStoreOptions {
  /** Namespace prepended to every key. @default 'apicache:' */
  keyPrefix?: string;
  /**
   * Enables cross-instance invalidation broadcast via Redis pub/sub (spec
   * `02`). Requires `client.publish`/`client.subscribe`. The Redis
   * instance/channel should be reachable only by the app's own servers —
   * anyone who can publish to it can trigger cache evictions on every
   * instance (an availability concern, never a data-exposure one, as long
   * as only tags/keys ever go over the wire).
   * @default false
   */
  crossInstance?: boolean;
  /** Channel name for invalidation broadcasts. @default 'apicache:invalidate' */
  channel?: string;
  /**
   * Custom (de)serializer, e.g. to add compression or a schema-versioned
   * envelope. `parse` must stay a safe structured-data parse — see
   * {@link RedisEntrySerializer}.
   * @default JSON.stringify / JSON.parse
   */
  serializer?: RedisEntrySerializer;
  /** Fires on any backend failure across get/set/delete/clear. See {@link StoreErrorHandler}. */
  onStoreError?: StoreErrorHandler;
}

/** `Math.random`-based id, good enough to disambiguate this instance's own echoed publish. */
function randomOrigin(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * A Redis-backed persistent store over an INJECTED client (so `redis`/`ioredis`
 * never becomes a dependency of this package). Entries are JSON-serialized; the
 * per-entry TTL (`expiresAt`) is applied via Redis `PX` so stale entries expire
 * server-side too. `clear()` is a no-op (namespace-wide deletion needs SCAN,
 * which varies by client) — delete keys individually or flush your namespace.
 *
 * @example
 * import { createClient as createRedis } from 'redis'
 * import { createRedisStore } from '@developerehsan/api-client/cache-stores'
 *
 * const redis = createRedis({ url: process.env.REDIS_URL })
 * await redis.connect()
 * const api = createClient({
 *   baseURL, openapi: { mode: 'runtime' },
 *   cache: { persistentStore: createRedisStore(redis, { keyPrefix: 'myapp:' }) },
 * })
 */
export function createRedisStore(
  client: RedisLikeClient,
  options: RedisStoreOptions = {},
): PersistentCacheStore {
  const prefix = options.keyPrefix ?? 'apicache:';
  const k = (key: string): string => `${prefix}${key}`;
  const crossInstance = options.crossInstance ?? false;
  const stringify = options.serializer?.stringify ?? ((entry: CacheEntry) => JSON.stringify(entry));
  const parse =
    options.serializer?.parse ??
    ((raw: string): CacheEntry | undefined => {
      try {
        const parsed: unknown = JSON.parse(raw);
        return isCacheEntry(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    });

  if (crossInstance && (!client.publish || !client.subscribe)) {
    throw new ConfigurationError(
      'createRedisStore({ crossInstance: true }) requires client.publish and client.subscribe.',
    );
  }

  const report = (error: unknown, context: StoreErrorContext): void => {
    try {
      options.onStoreError?.(error, context);
    } catch {
      /* a reporting hook must never break the store */
    }
  };

  const store: PersistentCacheStore = {
    async get(key) {
      try {
        const raw = await client.get(k(key));
        return raw === null ? undefined : parse(raw);
      } catch (error) {
        report(error, { op: 'get', key });
        return undefined;
      }
    },
    async set(key, entry) {
      try {
        const px = Math.max(0, entry.expiresAt - Date.now());
        // PX sets a millisecond TTL so Redis expires the entry in step with our own.
        if (px > 0) await client.set(k(key), stringify(entry), 'PX', px);
        else await client.set(k(key), stringify(entry));
      } catch (error) {
        report(error, { op: 'set', key });
      }
    },
    async delete(key) {
      try {
        await client.del(k(key));
      } catch (error) {
        report(error, { op: 'delete', key });
      }
    },
    async clear() {
      // Namespace-wide clear requires SCAN; unchanged no-op when the caller
      // hasn't wired `scanKeys` (spec 07 constraint #7: no silent behavior
      // change). Every deleted key is validated to actually sit inside this
      // store's OWN prefix before deletion — a buggy/unexpected `scanKeys`
      // implementation must never delete an unrelated application key
      // sharing the same Redis instance.
      if (!client.scanKeys) return;
      try {
        for await (const key of client.scanKeys(`${prefix}*`)) {
          if (typeof key === 'string' && key.startsWith(prefix)) await client.del(key);
        }
      } catch (error) {
        report(error, { op: 'clear' });
      }
    },
  };

  if (!crossInstance) return store;

  const channel = options.channel ?? 'apicache:invalidate';
  const origin = randomOrigin();
  const handlers = new Set<(msg: InvalidationMessage) => void>();

  void client.subscribe!(channel, (raw) => {
    const msg = parseInvalidationMessage(raw);
    if (!msg || msg.origin === origin) return;
    for (const handler of handlers) handler(msg);
  });

  return {
    ...store,
    onRemoteInvalidate(handler) {
      handlers.add(handler);
    },
    async publishInvalidate(msg: OutgoingInvalidationMessage) {
      await client.publish!(channel, JSON.stringify({ ...msg, origin }));
    },
  };
}
