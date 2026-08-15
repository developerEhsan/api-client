/**
 * Circuit breaker for a failing L2 store (spec 08.4): after N consecutive
 * failures, L2 calls stop entirely for a cooldown window (serve L1-only,
 * without paying the repeated timeout cost); a probe after cooldown closes
 * or reopens the circuit depending on outcome.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCache } from '../utilities/cache';
import { createLayeredCacheStore } from './layered';
import type { PersistentCacheStore } from './store.types';

function makeEntry(key: string) {
  return {
    key,
    data: { key },
    status: 200,
    headers: {},
    storedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

function makeFailingL2(): PersistentCacheStore & { calls: number } {
  const store = {
    calls: 0,
    get() {
      store.calls += 1;
      return Promise.reject(new Error('l2 down'));
    },
    set() {
      store.calls += 1;
      return Promise.reject(new Error('l2 down'));
    },
    delete() {
      store.calls += 1;
      return Promise.reject(new Error('l2 down'));
    },
    clear() {
      store.calls += 1;
      return Promise.reject(new Error('l2 down'));
    },
  };
  return store;
}

describe('circuit breaker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens after N consecutive failures and fires onStoreError with op="circuit-open"', async () => {
    const l1 = createCache();
    const l2 = makeFailingL2();
    const onStoreError = vi.fn();
    const layered = createLayeredCacheStore(l1, l2, {
      circuitBreaker: { failureThreshold: 2, cooldownMs: 10_000 },
      onStoreError,
    });

    layered.set('a', makeEntry('a'));
    await Promise.resolve();
    await Promise.resolve();
    expect(onStoreError).not.toHaveBeenCalledWith(expect.anything(), { op: 'circuit-open' });

    layered.set('b', makeEntry('b'));
    await Promise.resolve();
    await Promise.resolve();
    expect(onStoreError).toHaveBeenCalledWith(expect.anything(), { op: 'circuit-open' });
  });

  it('serves L1-only during cooldown (the failing L2 is never called again)', async () => {
    const l1 = createCache();
    const l2 = makeFailingL2();
    const layered = createLayeredCacheStore(l1, l2, {
      circuitBreaker: { failureThreshold: 1, cooldownMs: 10_000 },
    });

    layered.set('a', makeEntry('a'));
    await Promise.resolve();
    await Promise.resolve();
    const callsAtOpen = l2.calls;
    expect(callsAtOpen).toBeGreaterThan(0);

    // Circuit is open; further writes/reads must not touch L2 at all.
    layered.set('b', makeEntry('b'));
    layered.get('c');
    layered.delete('a');
    await Promise.resolve();
    await Promise.resolve();
    expect(l2.calls).toBe(callsAtOpen);

    // L1 itself still works normally (degraded-but-safe, not broken).
    expect(layered.get('b')).toBeDefined();
  });

  it('a successful probe after cooldown closes the circuit', async () => {
    vi.useFakeTimers();
    const l1 = createCache();
    let shouldFail = true;
    const l2: PersistentCacheStore = {
      get: () => (shouldFail ? Promise.reject(new Error('down')) : Promise.resolve(undefined)),
      set: () => (shouldFail ? Promise.reject(new Error('down')) : Promise.resolve()),
      delete: () => (shouldFail ? Promise.reject(new Error('down')) : Promise.resolve()),
      clear: () => (shouldFail ? Promise.reject(new Error('down')) : Promise.resolve()),
    };
    const onStoreError = vi.fn();
    const layered = createLayeredCacheStore(l1, l2, {
      circuitBreaker: { failureThreshold: 1, cooldownMs: 1000 },
      onStoreError,
    });

    layered.set('a', makeEntry('a'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onStoreError).toHaveBeenCalledWith(expect.anything(), { op: 'circuit-open' });

    // Still within cooldown: no probe.
    onStoreError.mockClear();
    shouldFail = false;
    layered.set('b', makeEntry('b'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onStoreError).not.toHaveBeenCalled();

    // Past cooldown: the next call probes and succeeds -> circuit closes.
    await vi.advanceTimersByTimeAsync(1100);
    layered.set('c', makeEntry('c'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onStoreError).toHaveBeenCalledWith(undefined, { op: 'circuit-close' });
  });

  it('a failed probe after cooldown reopens the circuit', async () => {
    vi.useFakeTimers();
    const l1 = createCache();
    const l2 = makeFailingL2();
    const onStoreError = vi.fn();
    const layered = createLayeredCacheStore(l1, l2, {
      circuitBreaker: { failureThreshold: 1, cooldownMs: 1000 },
      onStoreError,
    });

    layered.set('a', makeEntry('a'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onStoreError).toHaveBeenCalledWith(expect.anything(), { op: 'circuit-open' });

    await vi.advanceTimersByTimeAsync(1100);
    onStoreError.mockClear();
    const callsBeforeProbe = l2.calls;
    layered.set('b', makeEntry('b'));
    await vi.advanceTimersByTimeAsync(0);

    expect(l2.calls).toBe(callsBeforeProbe + 1); // the probe DID attempt L2
    expect(onStoreError).toHaveBeenCalledWith(expect.anything(), { op: 'circuit-open' }); // and reopened
  });
});
