# 09 — Filesystem cache store

Depends on: [`03-memory-aware-caching.md`](./03-memory-aware-caching.md) (this is really an alternative `mode` target for that problem), [`07-adapter-specific-cache-config.md`](./07-adapter-specific-cache-config.md) (same category as the Redis/IndexedDB adapters).

## Why this exists

User request, prompted by two existing real-world precedents worth naming
explicitly since they shape the design:

- **Next.js server-side data cache** persists fetch/route responses to disk
  (`.next/cache`) on a long-running server so the cache survives across
  requests without holding everything in process memory, and can survive a
  restart.
- **nginx `proxy_cache`** writes upstream responses to disk, keyed by a
  configurable key expression, with its own TTL/`inactive` eviction and a
  size cap on the cache directory.

Both are the same shape our `PersistentCacheStore` interface already
generalizes over (`cache-stores/store.types.ts:19-24`) — this file adds a
third concrete adapter (`createFileSystemStore`) alongside
`createIndexedDbStore`/`createRedisStore` (`cache-stores/index.ts`), not a
new abstraction.

## Where this fits and where it doesn't

Fits: **long-running Node server process** (VM/container SSR deployment —
exactly the low-RAM/high-traffic scenario from file `03`). Trades RAM for
disk; survives process restarts, which pure in-memory (`l1-only`) cannot.

Does **not** fit: serverless/edge functions (Lambda `/tmp`, Vercel functions,
Workers) — filesystem is ephemeral there, wiped per cold start, sometimes
entirely absent (edge runtimes). Does **not** solve cross-instance staleness
(file `02`'s problem) — each instance has its own disk. Explicitly do not
recommend a shared network filesystem (NFS/EFS) as a workaround: that
reintroduces cross-instance coordination with worse latency and file-locking
semantics than Redis already gives you (file `02`) — document this
directly so nobody reaches for it as a shortcut.

## Design

### Interface — same shape as the other two adapters

```ts
// cache-stores/index.ts
export interface FileSystemStoreOptions {
  /** Directory to store cache files in. Created if missing. @default './.api-client-cache' */
  dir?: string;
  /**
   * Max total bytes the cache directory may hold before proactive eviction
   * (oldest `storedAt` first). Checked lazily on write, not via a background
   * scan (avoid heavy `readdir`/`stat` cost on every request; see below).
   * @default optional, unset means no proactive size cap (matches the
   * network-store adapters' "capacity limits are your infra's job" stance —
   * but see the LRU-index approach below for a cheap way to enforce this)
   */
   maxSizeBytes?: number;
  /** File permission mode for written cache files. @default 0o600 (owner read/write only) */
  fileMode?: number;
  onStoreError?: (error: unknown, context: { op: 'get' | 'set' | 'delete' | 'clear'; key?: string }) => void; // same hook as file 07
}

export function createFileSystemStore(options: FileSystemStoreOptions = {}): PersistentCacheStore {
  // Node-only — feature-detect the same way createIndexedDbStore detects
  // `indexedDB` (cache-stores/index.ts:69). Must resolve to a safe no-op
  // PersistentCacheStore (never throw at construction time) when `node:fs`
  // isn't usable (e.g. accidentally constructed in a browser bundle).
}
```

### Key-to-filename mapping (security-critical, see below)

Never use the raw cache key as a path segment. Hash it — reuse the existing
FNV-1a `hash()` helper's approach or a stronger hash (SHA-256 via
`node:crypto` is fine here since this isn't a hot synchronous path the way
`computeCacheKey` is) to derive the filename:

```ts
import { createHash } from 'node:crypto';
function keyToFilename(key: string): string {
  return createHash('sha256').update(key).digest('hex') + '.json';
}
```

This guarantees the filename is always a fixed-length hex string — no
possibility of `../` traversal or filesystem-illegal characters reaching
`fs.writeFile`, regardless of what the cache key (which may embed a
developer-supplied `keyResolver` output, or file `10`'s custom key parts)
contains.

### Write path — atomic, permissioned

```ts
async set(key, entry) {
  const file = path.join(dir, keyToFilename(key));
  const tmp = `${file}.${randomSuffix()}.tmp`; // avoid Date.now()/Math.random() per repo convention if this logic ever runs inside a workflow script; fine in normal runtime code
  await fs.writeFile(tmp, JSON.stringify(entry), { mode: fileMode ?? 0o600 });
  await fs.rename(tmp, file); // atomic on POSIX — a crash mid-write never corrupts `file`
}
```

Rename-based atomic write is the same trick both Next.js's and nginx's disk
caches rely on — a reader never observes a half-written file.

### Read path — corrupt-file tolerance

```ts
async get(key) {
  try {
    const raw = await fs.readFile(path.join(dir, keyToFilename(key)), 'utf8');
    const parsed = JSON.parse(raw);
    return isCacheEntry(parsed) ? parsed : undefined; // reuse isCacheEntry from store.types.ts:27
  } catch {
    return undefined; // ENOENT, corrupt JSON, permission error — all treated as a miss
  }
}
```

### Size cap — lazy, not a background scanner

A full `maxSizeBytes` enforcement via directory-wide `readdir`+`stat` on
every write would be far too expensive at request scale. Two options,
recommend (a):

- **(a) Maintain a small sidecar index file** (`_index.json` in `dir`)
  tracking `{ filename, size, storedAt }` per entry, updated in-memory and
  flushed periodically (debounced write, not per-request) — `set()` checks
  the in-memory index total against `maxSizeBytes` and evicts oldest entries
  by `storedAt` without touching the filesystem beyond `unlink`. This
  mirrors nginx's own approach (an in-memory keys zone backing the on-disk
  cache) closely enough to be a familiar model.
- **(b) Skip proactive eviction entirely, document a cron/cleanup script
  instead** (delete files older than N days) — simpler, matches "IndexedDB
  quota is the browser's job" precedent, acceptable if (a) proves too
  complex for the value it adds. Pick based on implementation time budget;
  don't ship a half-working index (e.g. one that drifts from actual disk
  state after a crash) — a missing feature is better than a subtly wrong one.

### `clear()` — real, unlike Redis's current no-op

Unlike `createRedisStore`'s namespace-wide `clear()` (a no-op today per file
`07`, because SCAN semantics vary by client), a filesystem store can list
its own directory directly and delete everything in it — no external
service, no ambiguity:

```ts
async clear() {
  const files = await fs.readdir(dir);
  await Promise.all(files.map((f) => fs.unlink(path.join(dir, f)).catch(() => undefined)));
}
```

## Security constraints specific to this file

- **Path traversal**: covered above — filenames are always a hashed,
  fixed-format string, never derived directly from user/developer input.
  This must be tested explicitly (see below) since it's the single most
  important property of this adapter.
- **File permissions**: default `0o600` (owner-only). Document that the
  cache directory itself should not be inside a web-server-served static
  path (an obvious but real misconfiguration risk — a cache dir accidentally
  placed under `public/` would serve cached response bodies, potentially
  containing another user's data, to anyone).
- **At-rest sensitivity**: same tension as file `08`'s IndexedDB-encryption
  item — cached response bodies land in plaintext on disk. If the same
  `CacheCipher` interface from `08.5` is built, this adapter should accept
  it too (`encrypt?: CacheCipher`), for consistency across every
  disk/browser-persisted adapter rather than bolting encryption onto only
  one.
- **Symlink safety**: when resolving `dir`, do not follow a symlink placed
  by an untrusted process into a sensitive path — resolve `dir` with
  `fs.realpath` once at construction and refuse to proceed (throw
  `ConfigurationError`) if the resolved path differs unexpectedly from a
  configured allow-list, or at minimum document that `dir` must be a path
  the deploying application fully controls (this is a defense-in-depth note,
  not expected to be exploitable in the common case, but worth stating).
- Must feature-detect `node:fs`/`node:crypto` availability and resolve to a
  safe no-op store otherwise, exactly like `createIndexedDbStore` does for
  `indexedDB` — verify via `scripts/check-browser-bundle.mjs` that this
  adapter's code, if imported anywhere reachable from `/browser`, doesn't
  pull `node:fs` into the browser bundle. It should live in
  `cache-stores/index.ts` alongside the others, which is already excluded
  from the browser entry per existing conventions — confirm this stays true.

## Tests to add

`packages/core/src/cache-stores/filesystem.test.ts` (new, using a temp dir
per test, cleaned up after):
- Round-trip `set`/`get`/`delete`/`clear` correctness.
- A cache key containing `../../etc/passwd`-style content never escapes the
  configured `dir` — assert the written file's resolved path is always
  inside `dir` (the actual regression test for the path-traversal
  constraint above).
- A crash mid-write (simulate by leaving a stray `.tmp` file and no rename)
  never causes `get()` to return corrupt data — only the renamed file is
  ever read.
- Corrupt JSON on disk (hand-write garbage to a cache file) causes `get()`
  to return `undefined`, not throw.
- `maxSizeBytes` (if approach (a) is implemented) evicts oldest entries once
  exceeded; unset means no eviction (regression guard, matches other
  adapters' "opt-in limits only" default).
- File permission of a written cache file matches `fileMode`/default `0o600`
  (platform-permitting; skip on Windows CI if `fs.stat().mode` semantics
  differ).
- Constructing the store where `node:fs` is unavailable (simulate) resolves
  to a no-op store, never throws at construction time.

## Docs to update after shipping

`docs/cache-persistence.md` — new "Filesystem" section alongside IndexedDB/
Redis, explicitly stating the serverless/edge non-fit and the
"don't use NFS for cross-instance" guidance above.
