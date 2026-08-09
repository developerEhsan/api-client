# 03 — Memory-aware caching for constrained hosts

Depends on: [`01-tag-based-invalidation.md`](./01-tag-based-invalidation.md) (the tag index must be kept in sync with any new eviction path this file adds).

## Problem

`createCache()` (`packages/core/src/utilities/cache.ts:32-102`) bounds itself
by **entry count** (`maxSize`, default 500 — `cache.types.ts:70-75`), not by
memory footprint. On a small VM with high traffic, 500 entries of a few KB
each is fine; 500 entries of large JSON payloads (list endpoints, nested
objects) can push a constrained process (e.g. 512MB-1GB container) into
memory pressure or OOM-kill territory. There is currently no way to bound the
cache by actual bytes, and no way to opt a deployment out of in-memory
caching entirely in favor of an external store only.

## Current state (reference)

- `CacheConfig.maxSize` — `cache.types.ts:70-75`, count-based only.
- `createCache()` eviction — `utilities/cache.ts:44-53` (`evictOverflow`,
  pure count comparison `store.size > maxSize`).
- `createLayeredCacheStore` — `cache-stores/layered.ts:20-52` — always keeps
  an L1 in front of L2; no way today to run L2-only.
- `packages/core` ships runtime-specific bundles (`edge-light`/`node`/
  `browser`) per `CLAUDE.md` — any Node-only API here must be gated the same
  way.

## Design

### 1. Byte-size estimation and `maxSizeBytes`

```ts
// cache.types.ts — CacheConfig
export interface CacheConfig {
  // ...existing fields
  maxSize?: number;        // existing, count-based, still the default bound
  /**
   * Maximum approximate total size (bytes) of all L1 entries. When set, this
   * bounds eviction ALONGSIDE `maxSize` — whichever limit is hit first
   * triggers LRU eviction. Size is estimated cheaply (JSON length of
   * `data` + `headers`), not exact — do not rely on this for hard memory
   * guarantees, only for reasonable pressure relief.
   * @default optional, unset means only `maxSize` (count) bounds the cache
   */
  maxSizeBytes?: number;
}
```

Size estimation helper, colocated in `utilities/cache.ts`:

```ts
function estimateEntrySize(entry: CacheEntry): number {
  try {
    // Cheap, not exact: JSON.stringify cost is paid once per set(), not per read.
    return JSON.stringify(entry.data).length + JSON.stringify(entry.headers).length;
  } catch {
    return 0; // circular/non-serializable data — don't let estimation throw
  }
}
```

`createCache()` tracks a running `totalBytes` counter (updated on set/delete/
evict, not recomputed by walking the whole map each time — O(1) per
operation, matching the existing LRU's complexity). `evictOverflow` gains a
second condition: evict while `store.size > maxSize` **or**
`totalBytes > maxSizeBytes` (when configured).

### 2. Explicit storage `mode` switch

For the "small VM, high traffic" case, the real fix is often "don't hold
response bodies in this process's heap at all — go straight to Redis."
`createLayeredCacheStore` today unconditionally keeps L1 in front. Add:

```ts
// cache.types.ts — CacheConfig
export interface CacheConfig {
  // ...
  /**
   * Storage topology:
   * - 'layered' (default) — sync in-memory L1 in front of the optional L2.
   * - 'l1-only' — ignore `persistentStore` even if set (mostly for tests).
   * - 'l2-only' — skip the in-memory L1 entirely; every read/write goes
   *   through `persistentStore`, trading latency for near-zero local
   *   memory use. Requires `persistentStore` to be set.
   * @default 'layered'
   */
  mode?: 'layered' | 'l1-only' | 'l2-only';
}
```

`l2-only` needs a new store shape since the rest of the pipeline
(`createClient.ts:710-804`) assumes a **synchronous** `CacheStore` (no
`await` on the hot path, by design — see `layered.ts:1-5` doc comment). Two
implementation options, pick during implementation based on how invasive
each is:

- **(a) Async-aware pipeline path**: thread an `await` through the cache
  read/write in `createClient.ts` only when `mode === 'l2-only'`. Slightly
  more invasive but keeps a genuinely zero-local-memory mode.
- **(b) Bounded shadow L1**: keep a tiny synchronous L1 (e.g.
  `maxSize: 20`) even in "l2-only" mode, just enough to avoid a network
  round-trip for immediately-repeated reads, while keeping the memory bound
  tiny and explicit. Simpler, no pipeline changes, likely the better
  default — recommend starting here and only building (a) if a concrete
  latency complaint shows up.

Document whichever is chosen; don't half-implement both.

### 3. Optional memory-pressure guard (Node only, opt-in)

```ts
// cache.types.ts — CacheConfig
export interface CacheConfig {
  // ...
  /**
   * Node-only. When set, periodically checks `process.memoryUsage().rss`
   * and proactively evicts (oldest-first) when it crosses the threshold,
   * ahead of `maxSize`/`maxSizeBytes` limits. No-ops outside Node (edge/
   * browser) — feature-detected, safe to set anywhere.
   * @default optional, unset means no proactive pressure-based eviction
   */
  memoryPressure?: { thresholdMb: number; checkIntervalMs?: number };
}
```

Implementation must feature-detect the same way `createIndexedDbStore`
feature-detects `indexedDB` (`cache-stores/index.ts:69`):

```ts
const hasProcessMemory =
  typeof process !== 'undefined' && typeof process.memoryUsage === 'function';
if (config.memoryPressure && hasProcessMemory) {
  const interval = setInterval(() => {
    const rssMb = process.memoryUsage().rss / (1024 * 1024);
    if (rssMb > config.memoryPressure.thresholdMb) {
      // evict oldest N% of entries, reuse the existing LRU eviction path
    }
  }, config.memoryPressure.checkIntervalMs ?? 30_000);
  interval.unref?.(); // never keep the process alive just for this timer
}
```

**This must never be reachable from the `/browser` or `/edge-light` builds**
— gate the whole feature behind the `hasProcessMemory` check AND verify via
tsup entry configuration (`packages/core/tsup.config.ts`) that this code
path tree-shakes out of non-Node bundles. Re-run
`scripts/check-browser-bundle.mjs` after implementing.

## Example end-state usage

```ts
// small VM, high traffic — cap memory hard, skip local storage mostly
const api = createClient({
  baseURL,
  cache: {
    maxSizeBytes: 10 * 1024 * 1024, // 10MB soft cap on L1
    mode: 'l2-only',
    persistentStore: createRedisStore(redisClient),
    memoryPressure: { thresholdMb: 400 }, // proactive relief before OOM
  },
});
```

## Security / correctness constraints specific to this file

- Byte estimation must never throw on circular references or exotic values
  (see the `try/catch` above) — an estimation failure must degrade to "treat
  as size 0," never crash a request.
- The eviction path added here (byte-based, pressure-based) must call
  `tagIndex.untrack(key)` (from file `01`) for every key it evicts, same as
  the existing count-based `evictOverflow` — otherwise the tag index
  accumulates references to keys no longer in the store, and
  `invalidateTags` would report removing keys that don't exist (harmless but
  wrong bookkeeping; fix by co-locating eviction through one shared internal
  function rather than duplicating the loop).
- `l2-only` mode must still respect the auth-fingerprint scoping in
  `computeCacheKey` — this file changes *where* entries live, never *how*
  they're keyed. Don't introduce a second key-computation path.

## Tests to add

`packages/core/src/utilities/cache.test.ts` (extend):
- `maxSizeBytes` evicts oldest entries once the running byte estimate
  exceeds the configured cap, independent of `maxSize` count.
- Non-serializable `data` (e.g. a value with a circular reference) doesn't
  throw during `set()`; estimated size falls back to 0.

`packages/core/src/cache-stores/mode.test.ts` (new):
- `mode: 'l2-only'` never grows the local L1 beyond its small bound even
  under heavy write volume (assert `cacheStore.size()` stays capped).
- `mode: 'l1-only'` ignores a configured `persistentStore` entirely (no
  calls into it) — useful for the test suite itself too.

`packages/core/src/utilities/memoryPressure.test.ts` (new, Node-only test
file): mock `process.memoryUsage`, assert eviction fires once threshold is
crossed and not before; assert the feature no-ops when
`process.memoryUsage` is undefined (simulate edge runtime).

## Docs to update after shipping

`docs/cache-persistence.md` — add a "constrained hosts / high traffic, low
memory" section with the example above.
