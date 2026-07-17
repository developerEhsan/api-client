/**
 * Server-side rate limiter for the RPC bridge (roadmap E3). Plugs into
 * `createRpcHandler`'s `onRequest` hook and throws a uniform, sanitized
 * `rate_limited` error (HTTP 429 in the envelope) when a key exceeds its budget.
 *
 * SECURITY (S20): the default key is NOT derived from a spoofable header.
 * `X-Forwarded-For` is honored only when `trustProxy: true` (you terminate a
 * trusted proxy); otherwise all callers share one global budget. The in-memory
 * store is bounded (LRU) so a flood of distinct keys cannot exhaust memory.
 */
import type { RpcRequestContext } from './createRpcHandler';
import { RpcSecurityError } from './security';

/** A minimal call shape the limiter needs (module/method), transport-agnostic. */
export interface RateLimitCall {
  module: string;
  method: string;
}

/** One counter window for a key. */
export interface RateLimitHit {
  /** Requests counted in the current window (including this one). */
  count: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
}

/** Pluggable counter backend (swap for Redis, etc.). */
export interface RateLimitStore {
  hit(key: string, windowMs: number, now: number): RateLimitHit | Promise<RateLimitHit>;
}

/** Options for {@link createRateLimiter}. */
export interface RateLimiterOptions {
  /** Window length in ms. */
  windowMs: number;
  /** Max requests allowed per key per window. */
  max: number;
  /**
   * Derive the bucket key from the request. Default: the first `X-Forwarded-For`
   * hop when `trustProxy` is true, else the constant `"global"`.
   */
  keyFor?: (ctx: RpcRequestContext, call: RateLimitCall) => string | Promise<string>;
  /**
   * Trust `X-Forwarded-For` for the default key. Leave `false` unless a trusted
   * proxy sets it — otherwise clients spoof it to evade/forge limits (S20).
   * @default false
   */
  trustProxy?: boolean;
  /** Counter backend. Default: a bounded in-memory fixed-window store. */
  store?: RateLimitStore;
  /** Max distinct keys held by the default memory store (LRU bound). @default 10000 */
  maxKeys?: number;
}

/** The limiter surface: an `onRequest` hook plus a standalone `check`. */
export interface RateLimiter {
  /** `createRpcHandler` `onRequest`-compatible guard; throws when over budget. */
  onRequest(ctx: RpcRequestContext, call: RateLimitCall): Promise<void>;
  /** Count one hit for `key`; throws `rate_limited` when the budget is exceeded. */
  check(key: string): Promise<RateLimitHit>;
}

/** A synchronous rate-limit store (the in-memory default). */
export interface SyncRateLimitStore extends RateLimitStore {
  hit(key: string, windowMs: number, now: number): RateLimitHit;
}

/** A bounded fixed-window in-memory store (LRU eviction on key count). */
export function createMemoryRateLimitStore(maxKeys = 10_000): SyncRateLimitStore {
  const windows = new Map<string, RateLimitHit>();
  return {
    hit(key, windowMs, now): RateLimitHit {
      const existing = windows.get(key);
      let entry: RateLimitHit;
      if (existing && now < existing.resetAt) {
        entry = { count: existing.count + 1, resetAt: existing.resetAt };
      } else {
        entry = { count: 1, resetAt: now + windowMs };
      }
      // Re-insert to move the key to the most-recently-used position.
      windows.delete(key);
      windows.set(key, entry);
      // Evict the least-recently-used key when over the bound (S20: no unbounded
      // growth from a flood of distinct keys).
      if (windows.size > maxKeys) {
        const oldest = windows.keys().next().value;
        if (oldest !== undefined) windows.delete(oldest);
      }
      return entry;
    },
  };
}

/**
 * Create a rate limiter. Wire it as the handler's `onRequest` (it throws to
 * reject a request over budget).
 *
 * @example
 * // 100 requests/minute, keyed per session cookie:
 * import { createRateLimiter, createRpcHandler } from '@developerehsan/api-client/server'
 *
 * const limiter = createRateLimiter({
 *   windowMs: 60_000,
 *   max: 100,
 *   keyFor: async (ctx) => (await ctx.getCookie?.('session')) ?? 'anon',
 * })
 * export const handler = createRpcHandler(api, { expose, onRequest: limiter.onRequest })
 *
 * @example
 * // Per-IP behind a trusted proxy (honors X-Forwarded-For only when trustProxy):
 * const limiter = createRateLimiter({ windowMs: 10_000, max: 30, trustProxy: true })
 *
 * @example
 * // Custom (e.g. Redis-backed) store:
 * const limiter = createRateLimiter({ windowMs: 60_000, max: 100, store: myRedisStore })
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { windowMs, max, trustProxy = false } = options;
  const store = options.store ?? createMemoryRateLimitStore(options.maxKeys ?? 10_000);

  const defaultKeyFor = async (ctx: RpcRequestContext): Promise<string> => {
    if (trustProxy) {
      const xff = await ctx.getHeader?.('x-forwarded-for');
      const first = typeof xff === 'string' ? xff.split(',')[0]?.trim() : undefined;
      if (first) return first;
    }
    return 'global';
  };
  const keyFor = options.keyFor;

  const now = (): number => Date.now();

  const check = async (key: string): Promise<RateLimitHit> => {
    const hit = await store.hit(key, windowMs, now());
    if (hit.count > max) {
      // Uniform sanitized denial; status 429 rides the RpcResponse envelope.
      throw new RpcSecurityError('rate_limited', 429);
    }
    return hit;
  };

  return {
    check,
    async onRequest(ctx, call) {
      const key = keyFor ? await keyFor(ctx, call) : await defaultKeyFor(ctx);
      await check(key);
    },
  };
}
