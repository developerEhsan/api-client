import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors/ApiError';
import { type ResolvedRetryOptions, computeBackoff, parseRetryAfter, withRetry } from './retry';

const base = (over: Partial<ResolvedRetryOptions> = {}): ResolvedRetryOptions => ({
  attempts: 3,
  backoff: 'exponential',
  baseDelay: 100,
  maxDelay: 10_000,
  jitter: false,
  ...over,
});

describe('computeBackoff', () => {
  it('produces an exponential sequence (jitter off)', () => {
    const opts = base({ backoff: 'exponential', baseDelay: 100 });
    expect([1, 2, 3, 4].map((a) => computeBackoff(a, opts))).toEqual([100, 200, 400, 800]);
  });

  it('produces a linear sequence (jitter off)', () => {
    const opts = base({ backoff: 'linear', baseDelay: 100 });
    expect([1, 2, 3, 4].map((a) => computeBackoff(a, opts))).toEqual([100, 200, 300, 400]);
  });

  it('produces a fixed sequence (jitter off)', () => {
    const opts = base({ backoff: 'fixed', baseDelay: 100 });
    expect([1, 2, 3, 4].map((a) => computeBackoff(a, opts))).toEqual([100, 100, 100, 100]);
  });

  it('caps the computed delay at maxDelay', () => {
    const opts = base({ backoff: 'exponential', baseDelay: 1000, maxDelay: 3000 });
    expect(computeBackoff(1, opts)).toBe(1000);
    expect(computeBackoff(2, opts)).toBe(2000);
    expect(computeBackoff(10, opts)).toBe(3000);
  });

  it('applies full jitter within [0, cappedDelay]', () => {
    const opts = base({ backoff: 'fixed', baseDelay: 1000, jitter: true });
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(computeBackoff(1, opts)).toBe(500);
    spy.mockRestore();
  });

  it('prefers Retry-After over computed backoff', () => {
    const opts = base({ backoff: 'exponential', baseDelay: 100 });
    expect(computeBackoff(3, opts, 5000)).toBe(5000);
  });
});

describe('parseRetryAfter', () => {
  it('parses delta-seconds into ms', () => {
    expect(parseRetryAfter({ 'retry-after': '120' })).toBe(120_000);
  });

  it('is case-insensitive on the header name', () => {
    expect(parseRetryAfter({ 'Retry-After': '5' })).toBe(5000);
  });

  it('parses an HTTP-date into a positive delta', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const future = new Date('2026-01-01T00:00:30Z').toUTCString();
    expect(parseRetryAfter({ 'retry-after': future })).toBe(30_000);
    vi.useRealTimers();
  });

  it('returns 0 for a past HTTP-date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const past = new Date('2025-12-31T23:59:00Z').toUTCString();
    expect(parseRetryAfter({ 'retry-after': past })).toBe(0);
    vi.useRealTimers();
  });

  it('returns undefined when absent or unparsable', () => {
    expect(parseRetryAfter({})).toBeUndefined();
    expect(parseRetryAfter({ 'retry-after': '  ' })).toBeUndefined();
    expect(parseRetryAfter({ 'retry-after': 'not-a-date' })).toBeUndefined();
  });
});

describe('withRetry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const retryable = () => new ApiError({ message: 'boom', status: 503 });
  const nonRetryable = () => new ApiError({ message: 'bad', status: 400 });

  it('succeeds on the second attempt', async () => {
    const fn = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(retryable())
      .mockResolvedValueOnce('ok');
    const onRetry = vi.fn();

    const promise = withRetry(fn, base({ onRetry }));
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 1);
    expect(fn).toHaveBeenNthCalledWith(2, 2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(ApiError));
  });

  it('stops immediately on a non-retryable error', async () => {
    const err = nonRetryable();
    const fn = vi.fn<(attempt: number) => Promise<string>>().mockRejectedValue(err);

    const promise = withRetry(fn, base());
    await expect(promise).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts all attempts then rethrows the final error', async () => {
    const fn = vi.fn<(attempt: number) => Promise<string>>().mockRejectedValue(retryable());

    const promise = withRetry(fn, base({ attempts: 3 }));
    const assertion = expect(promise).rejects.toBeInstanceOf(ApiError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('honors a custom retryOn predicate', async () => {
    const err = nonRetryable();
    const fn = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce('ok');

    const promise = withRetry(fn, base({ retryOn: () => true }));
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('stops retrying when the signal is aborted mid-retry', async () => {
    const controller = new AbortController();
    const err = retryable();
    const fn = vi.fn<(attempt: number) => Promise<string>>().mockRejectedValue(err);
    const sleep = vi.fn(async () => {
      controller.abort();
    });

    const promise = withRetry(fn, base({ attempts: 5 }), {
      signal: controller.signal,
      sleep,
    });
    await expect(promise).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-ApiError failures', async () => {
    const err = new Error('plain');
    const fn = vi.fn<(attempt: number) => Promise<string>>().mockRejectedValue(err);

    await expect(withRetry(fn, base())).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses the injected sleep with the computed backoff delay', async () => {
    const fn = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(retryable())
      .mockResolvedValueOnce('ok');
    const sleep = vi.fn(async () => {});

    await withRetry(fn, base({ backoff: 'exponential', baseDelay: 100 }), { sleep });
    // Sleep now receives the abort signal (undefined here) as a second arg.
    expect(sleep).toHaveBeenCalledWith(100, undefined);
  });
});
