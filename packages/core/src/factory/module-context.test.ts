/**
 * Module-context enrichment tests (D1/D2): ctx.run generic runner, ctx.emit,
 * ctx.logger, ctx.config.
 */
import { describe, expect, it, vi } from 'vitest';
import { NetworkError } from '../errors/NetworkError';
import { TimeoutError } from '../errors/TimeoutError';
import { createMockClient } from '../testing/createMockClient';
import type { ModuleContext } from '../types/module.types';

/** Build a client whose single module exposes ctx directly for assertions. */
function clientWithCtx() {
  let captured: ModuleContext | undefined;
  const { api } = createMockClient({
    tenancy: { getTenantId: () => 'tenant-1' },
    modules: {
      auto: false as const,
      tasks: {
        methods: {
          expose: async (ctx: ModuleContext) => {
            captured = ctx;
            return ctx;
          },
          // biome-ignore lint/suspicious/noExplicitAny: test passthrough of arbitrary op.
          runOp: async (ctx: ModuleContext, key: string, fn: any, opts?: any) =>
            ctx.run(key, fn, opts),
        },
      },
    },
  });
  void captured;
  return { api: api as unknown as {
    on: (event: string, listener: (payload: unknown) => void) => void;
    tasks: {
      expose: () => Promise<ModuleContext>;
      runOp: <T>(key: string, fn: (s?: AbortSignal) => Promise<T>, opts?: unknown) => Promise<T>;
    };
  } };
}

describe('ctx.run — generic operation runner', () => {
  it('runs arbitrary async work and returns its result', async () => {
    const { api } = clientWithCtx();
    const result = await api.tasks.runOp('compute', async () => 21 * 2);
    expect(result).toBe(42);
  });

  it('propagates the developer error unchanged (no forced wrapping)', async () => {
    const { api } = clientWithCtx();
    class DomainError extends Error {}
    await expect(
      api.tasks.runOp('x', async () => {
        throw new DomainError('nope');
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('dedupes identical concurrent operations when opted in', async () => {
    const { api } = clientWithCtx();
    let calls = 0;
    const fn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return calls;
    };
    const [a, b] = await Promise.all([
      api.tasks.runOp('dupe', fn, { dedupe: true }),
      api.tasks.runOp('dupe', fn, { dedupe: true }),
    ]);
    expect(calls).toBe(1); // collapsed into one execution
    expect(a).toBe(b);
  });

  it('does NOT dedupe by default', async () => {
    const { api } = clientWithCtx();
    let calls = 0;
    const fn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return calls;
    };
    await Promise.all([api.tasks.runOp('nd', fn), api.tasks.runOp('nd', fn)]);
    expect(calls).toBe(2);
  });

  it('retries retryable errors up to the attempt limit', async () => {
    const { api } = clientWithCtx();
    let attempts = 0;
    const result = await api.tasks.runOp(
      'retry',
      async () => {
        attempts++;
        if (attempts < 3) throw new NetworkError({ message: 'flaky' });
        return 'ok';
      },
      { retry: { attempts: 3, baseDelay: 0, maxDelay: 0, jitter: false } },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('does not retry a non-retryable error by default', async () => {
    const { api } = clientWithCtx();
    let attempts = 0;
    await expect(
      api.tasks.runOp(
        'noretry',
        async () => {
          attempts++;
          throw new Error('boom');
        },
        { retry: { attempts: 5, baseDelay: 0, maxDelay: 0, jitter: false } },
      ),
    ).rejects.toThrow('boom');
    expect(attempts).toBe(1);
  });

  it('enforces a timeout, raising TimeoutError', async () => {
    const { api } = clientWithCtx();
    await expect(
      api.tasks.runOp('slow', () => new Promise((r) => setTimeout(r, 1000)), { timeout: 20 }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('passes an abort signal to execute on timeout', async () => {
    const { api } = clientWithCtx();
    let sawAbort = false;
    await expect(
      api.tasks.runOp(
        'sig',
        (signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              sawAbort = true;
              reject(new Error('aborted'));
            });
          }),
        { timeout: 20 },
      ),
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(sawAbort).toBe(true);
  });
});

describe('ctx.emit / ctx.logger / ctx.config', () => {
  it('ctx.emit routes to a namespaced client event', async () => {
    const { api } = clientWithCtx();
    const ctx = await api.tasks.expose();
    const seen: unknown[] = [];
    // Subscribe on the client Proxy (which exposes `on`); ctx.emit namespaces it.
    api.on('module:tasks:progress', (p) => seen.push(p));
    ctx.emit('progress', { pct: 50 });
    expect(seen).toEqual([{ pct: 50 }]);
  });

  it('ctx.config returns a redacted snapshot for the module', async () => {
    const { api } = clientWithCtx();
    const ctx = await api.tasks.expose();
    const snap = ctx.config();
    expect(snap.tenancy.headerName).toBe('X-Tenant-ID');
    expect(snap.auth).toEqual({ strategy: 'none' });
  });

  it('ctx.logger exposes the four levels without throwing', async () => {
    const { api } = clientWithCtx();
    const ctx = await api.tasks.expose();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => ctx.logger.warn('hi')).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
