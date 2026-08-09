/**
 * L1(sync) + L2(async) cache layering. Kept in its own module (dependency-light:
 * only the cache utility + types) so the core client can import it WITHOUT
 * pulling in the IndexedDB/Redis reference stores.
 */
import type { CacheStore } from '../utilities/cache';
import { isFresh } from '../utilities/cache';
import type { PersistentCacheStore } from './store.types';

/** Fires on any backend failure, plus circuit state transitions (spec 08.4). */
export type LayeredStoreErrorHandler = (
  error: unknown,
  context: { op: 'get' | 'set' | 'delete' | 'clear' | 'circuit-open' | 'circuit-close'; key?: string },
) => void;

export interface LayeredCacheStoreOptions {
  /**
   * Minimal circuit breaker for a failing L2: after `failureThreshold`
   * CONSECUTIVE failures, stop attempting L2 calls for `cooldownMs` (serve
   * L1-only — the same degraded-but-safe behavior L2 failures already fall
   * back to, just without paying the repeated timeout cost). After the
   * cooldown, one probe attempt runs (half-open): success closes the
   * circuit, failure reopens it for another cooldown window.
   * @default optional, unset means no circuit breaker (today's behavior:
   * every call attempts L2)
   */
  circuitBreaker?: { failureThreshold: number; cooldownMs: number };
  /** Fires on an L2 failure or a circuit state transition. Never receives cached `data`. */
  onStoreError?: LayeredStoreErrorHandler;
}

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
export function createLayeredCacheStore(
  l1: CacheStore,
  l2: PersistentCacheStore,
  options: LayeredCacheStoreOptions = {},
): CacheStore {
  const breakerConfig = options.circuitBreaker;
  let consecutiveFailures = 0;
  let circuitOpenedAt: number | undefined;

  const report: LayeredStoreErrorHandler = (error, context) => {
    try {
      options.onStoreError?.(error, context);
    } catch {
      /* a reporting hook must never break the store */
    }
  };

  /** True when the circuit is open AND still within its cooldown window. */
  const circuitBlocking = (): boolean => {
    if (!breakerConfig || circuitOpenedAt === undefined) return false;
    return Date.now() - circuitOpenedAt < breakerConfig.cooldownMs;
  };

  const onL2Success = (): void => {
    if (consecutiveFailures > 0 || circuitOpenedAt !== undefined) {
      report(undefined, { op: 'circuit-close' });
    }
    consecutiveFailures = 0;
    circuitOpenedAt = undefined;
  };

  const onL2Failure = (error: unknown, key: string | undefined, op: 'get' | 'set' | 'delete' | 'clear'): void => {
    report(error, { op, key });
    if (!breakerConfig) return;
    consecutiveFailures += 1;
    // This failure only ran because the circuit was closed OR a post-cooldown
    // probe just ran (guardedL2 only invokes L2 in those two cases) — so
    // reopening (and re-reporting) unconditionally on threshold is correct,
    // including a failed probe re-opening an already-"open" circuit.
    if (consecutiveFailures >= breakerConfig.failureThreshold) {
      circuitOpenedAt = Date.now();
      report(error, { op: 'circuit-open' });
    }
  };

  /** Run an L2 call unless the circuit is open+cooling; track success/failure either way. */
  const guardedL2 = (
    op: 'get' | 'set' | 'delete' | 'clear',
    key: string | undefined,
    run: () => Promise<unknown>,
  ): void => {
    if (circuitBlocking()) return;
    void run().then(onL2Success, (error: unknown) => onL2Failure(error, key, op));
  };

  return {
    get(key) {
      const hit = l1.get(key);
      if (hit !== undefined) return hit;
      guardedL2('get', key, () =>
        l2.get(key).then((entry) => {
          if (entry && isFresh(entry) && l1.get(key) === undefined) l1.set(key, entry);
        }),
      );
      return undefined;
    },
    set(key, entry) {
      l1.set(key, entry);
      guardedL2('set', key, () => l2.set(key, entry));
    },
    has: (key) => l1.has(key),
    delete(key) {
      guardedL2('delete', key, () => l2.delete(key));
      return l1.delete(key);
    },
    clear() {
      guardedL2('clear', undefined, () => l2.clear());
      l1.clear();
    },
    invalidate: (pattern) => l1.invalidate(pattern),
    keysMatching: (pattern) => l1.keysMatching(pattern),
    size: () => l1.size(),
    isStale: (key) => l1.isStale(key),
  };
}
