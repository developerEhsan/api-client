/**
 * Rate limiter tests (E3), including S20 threat cases: spoofed-XFF must not
 * evade/forge limits by default, and the memory store must stay bounded.
 */
import { describe, expect, it } from 'vitest';
import { createRpcHandler } from './createRpcHandler';
import { type RpcRequestContext, createMemoryRateLimitStore, createRateLimiter } from './index';

const ctxWith = (xff?: string): RpcRequestContext => ({
  getHeader: (name) => (name === 'x-forwarded-for' ? xff : undefined),
});

describe('createRateLimiter', () => {
  it('allows up to `max` then throws a 429 rate_limited error', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
    const call = { module: 'pet', method: 'getPetById' };
    await limiter.onRequest(ctxWith(), call);
    await limiter.onRequest(ctxWith(), call);
    await expect(limiter.onRequest(ctxWith(), call)).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
    });
  });

  it('S20: ignores spoofed X-Forwarded-For by default (shared global budget)', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
    const call = { module: 'pet', method: 'getPetById' };
    // Different spoofed IPs must NOT each get their own budget.
    await limiter.onRequest(ctxWith('1.1.1.1'), call);
    await limiter.onRequest(ctxWith('2.2.2.2'), call);
    await expect(limiter.onRequest(ctxWith('3.3.3.3'), call)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('honors per-IP buckets only when trustProxy is enabled', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, trustProxy: true });
    const call = { module: 'pet', method: 'getPetById' };
    await limiter.onRequest(ctxWith('1.1.1.1'), call);
    // A different IP has its own budget.
    await expect(limiter.onRequest(ctxWith('2.2.2.2'), call)).resolves.toBeUndefined();
    // The first IP is now over budget.
    await expect(limiter.onRequest(ctxWith('1.1.1.1'), call)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('supports a custom keyFor (e.g. per session)', async () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 1,
      keyFor: (ctx) => (ctx['session'] as string) ?? 'anon',
    });
    const call = { module: 'pet', method: 'x' };
    await limiter.onRequest({ session: 'a' }, call);
    await expect(limiter.onRequest({ session: 'b' }, call)).resolves.toBeUndefined();
    await expect(limiter.onRequest({ session: 'a' }, call)).rejects.toMatchObject({ status: 429 });
  });
});

describe('createMemoryRateLimitStore', () => {
  it('resets the window after it elapses', () => {
    const store = createMemoryRateLimitStore();
    const a = store.hit('k', 1000, 0);
    expect(a.count).toBe(1);
    expect(store.hit('k', 1000, 500).count).toBe(2);
    // After resetAt, the counter restarts.
    expect(store.hit('k', 1000, 1500).count).toBe(1);
  });

  it('S20: stays bounded — evicts the least-recently-used key past maxKeys', () => {
    const store = createMemoryRateLimitStore(2);
    store.hit('a', 1000, 0);
    store.hit('b', 1000, 0);
    store.hit('c', 1000, 0); // evicts 'a' (LRU)
    // 'a' was evicted, so it starts fresh at count 1.
    expect(store.hit('a', 1000, 0).count).toBe(1);
    // 'c' is still tracked.
    expect(store.hit('c', 1000, 0).count).toBe(2);
  });
});

describe('rate limiter through createRpcHandler', () => {
  it('surfaces a 429 in the RpcResponse envelope when over budget', async () => {
    const api = { pet: { getPetById: () => Promise.resolve({ id: 1 }) } };
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    const h = createRpcHandler(api, {
      expose: { pet: ['getPetById'] },
      onRequest: limiter.onRequest,
    });
    const ok = await h.handle({ module: 'pet', method: 'getPetById', args: [] });
    expect(ok.ok).toBe(true);
    const denied = await h.handle({ module: 'pet', method: 'getPetById', args: [] });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.status).toBe(429);
  });
});
