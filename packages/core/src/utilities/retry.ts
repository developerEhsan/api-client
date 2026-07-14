/**
 * Retry orchestration: backoff computation, `Retry-After` parsing, and a
 * generic retry runner. Pure timing math plus a thin async loop; no IO.
 */

import type { ApiError } from '../errors/ApiError';

/** Fully-resolved retry policy (defaults already applied upstream). */
export interface ResolvedRetryOptions {
  /** Total number of attempts, inclusive of the first try (e.g. 3 => up to 3 tries). */
  attempts: number;
  /** Backoff growth strategy across attempts. */
  backoff: 'exponential' | 'linear' | 'fixed';
  /** Base delay in ms used by every strategy. */
  baseDelay: number;
  /** Upper bound (ms) applied after the strategy computes a delay. */
  maxDelay: number;
  /** When true, apply full jitter: pick a random delay in `[0, cappedDelay]`. */
  jitter: boolean;
  /** Predicate deciding retryability; defaults to `error.isRetryable`. */
  retryOn?: (error: ApiError) => boolean;
  /** Invoked before each re-attempt with the 1-based attempt just failed. */
  onRetry?: (attempt: number, error: ApiError) => void;
}

/**
 * Compute the delay (ms) to wait before the given retry attempt (1-based).
 * A defined `retryAfterMs` (from a `Retry-After` header) is preferred over the
 * strategy result. Otherwise the strategy value is capped at `maxDelay`, then
 * full jitter is applied when enabled.
 */
export function computeBackoff(
  attempt: number,
  opts: ResolvedRetryOptions,
  retryAfterMs?: number,
): number {
  // A server Retry-After is honored, but still capped by maxDelay so a hostile
  // or oversized header cannot force an unbounded wait (spec §3.1 maxDelay).
  if (retryAfterMs !== undefined && retryAfterMs >= 0) {
    return Math.min(retryAfterMs, opts.maxDelay);
  }

  let delay: number;
  switch (opts.backoff) {
    case 'exponential':
      delay = opts.baseDelay * 2 ** (attempt - 1);
      break;
    case 'linear':
      delay = opts.baseDelay * attempt;
      break;
    case 'fixed':
      delay = opts.baseDelay;
      break;
  }

  const capped = Math.min(delay, opts.maxDelay);
  return opts.jitter ? Math.random() * capped : capped;
}

/**
 * Extract a `Retry-After` value (delta-seconds or HTTP-date) from a header map
 * and convert it to milliseconds. Returns `undefined` when absent or unparsable.
 */
export function parseRetryAfter(headers: Record<string, string>): number | undefined {
  let raw: string | undefined;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'retry-after') {
      raw = headers[key];
      break;
    }
  }
  if (raw === undefined) return undefined;

  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  // Numeric form: delta-seconds.
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  // HTTP-date form.
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return undefined;
  const delta = when - Date.now();
  return delta > 0 ? delta : 0;
}

/** Injectable dependencies for {@link withRetry}. */
export interface WithRetryDeps {
  /** When aborted, stop retrying and surface the last error immediately. */
  signal?: AbortSignal;
  /** Sleep implementation; defaults to an abort-aware `setTimeout` delay. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signalReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(signalReason(signal));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });

function signalReason(signal?: AbortSignal): Error {
  const reason = (signal as { reason?: unknown } | undefined)?.reason;
  if (reason instanceof Error) return reason;
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

const isApiError = (error: unknown): error is ApiError =>
  typeof error === 'object' && error !== null && 'isRetryable' in error && 'retryCount' in error;

/**
 * Run `fn`, retrying failures per `opts`. `fn` receives the 1-based attempt
 * number. Retryability is decided by `opts.retryOn` or, absent that, by
 * `error.isRetryable`. A `Retry-After` header on the error's response is
 * honored over computed backoff. Aborting `deps.signal` stops retries and
 * rethrows the last error. The final error is rethrown unchanged.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: ResolvedRetryOptions,
  deps?: WithRetryDeps,
): Promise<T> {
  const sleep = deps?.sleep ?? defaultSleep;
  const signal = deps?.signal;
  const shouldRetry = opts.retryOn ?? ((error: ApiError) => error.isRetryable);

  let lastError: unknown;
  const total = Math.max(1, opts.attempts);

  for (let attempt = 1; attempt <= total; attempt++) {
    if (signal?.aborted) throw lastError ?? signal.reason;
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      // Non-ApiError failures are not classifiable; do not retry.
      if (!isApiError(error)) throw error;

      const isLast = attempt >= total;
      if (isLast || !shouldRetry(error) || signal?.aborted) throw error;

      opts.onRetry?.(attempt, error);

      const headers = extractResponseHeaders(error);
      const delay = computeBackoff(attempt, opts, headers ? parseRetryAfter(headers) : undefined);
      // Abort-aware: if the signal fires during the wait, sleep rejects with an
      // AbortError, which propagates out immediately (interruptible backoff).
      await sleep(delay, signal);

      if (signal?.aborted) throw error;
    }
  }

  throw lastError;
}

/**
 * Best-effort extraction of response headers from an ApiError for `Retry-After`
 * lookup. ApiError does not carry a response envelope directly, so we probe a
 * `response.headers` shape if present on the error.
 */
function extractResponseHeaders(error: ApiError): Record<string, string> | undefined {
  return error.responseHeaders;
}
