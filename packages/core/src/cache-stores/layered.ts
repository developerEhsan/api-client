/**
 * L1(sync) + L2(async) cache layering. Kept in its own module (dependency-light:
 * only the cache utility + types) so the core client can import it WITHOUT
 * pulling in the IndexedDB/Redis reference stores.
 */
import type { CacheStore } from '../utilities/cache';
import { isFresh } from '../utilities/cache';
import type { PersistentCacheStore } from './store.types';

/**
 * Layer a synchronous L1 {@link CacheStore} in front of an async
 * {@link PersistentCacheStore} L2, exposing the SAME synchronous `CacheStore`
 * interface so the request pipeline is unchanged (no await on the hot path):
 *  - `get`: returns L1 immediately; on an L1 miss it fires an async L2 read and,
 *    if that entry is still fresh, warms L1 so the NEXT read hits.
 *  - `set`/`delete`/`clear`: apply to L1 synchronously and write through to L2
 *    (fire-and-forget); L2 errors never break a request.
 * The remaining sync methods delegate to L1.
 */
export function createLayeredCacheStore(l1: CacheStore, l2: PersistentCacheStore): CacheStore {
  const swallow = (p: Promise<unknown>): void => {
    void p.catch(() => undefined);
  };
  return {
    get(key) {
      const hit = l1.get(key);
      if (hit !== undefined) return hit;
      swallow(
        l2.get(key).then((entry) => {
          if (entry && isFresh(entry) && l1.get(key) === undefined) l1.set(key, entry);
        }),
      );
      return undefined;
    },
    set(key, entry) {
      l1.set(key, entry);
      swallow(l2.set(key, entry));
    },
    has: (key) => l1.has(key),
    delete(key) {
      swallow(l2.delete(key));
      return l1.delete(key);
    },
    clear() {
      swallow(l2.clear());
      l1.clear();
    },
    invalidate: (pattern) => l1.invalidate(pattern),
    size: () => l1.size(),
    isStale: (key) => l1.isStale(key),
  };
}
