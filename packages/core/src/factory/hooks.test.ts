/**
 * Hook composition + parity tests (Workstream A1).
 *
 * Covers `composeHooks` in isolation and the composed behavior end-to-end
 * through the pipeline: global + module + per-call hooks all fire, in order,
 * with transforming hooks chaining and notification-hook errors isolated.
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors/ApiError';
import { createMockClient } from '../testing/createMockClient';
import type { PerCallConfig } from '../types/config.types';
import type { ApiRequest, ApiResponse } from '../types/http.types';
import type { ModuleContext } from '../types/module.types';
import { composeHooks } from './composeHooks';

const req = (headers: Record<string, string> = {}): ApiRequest => ({
  url: 'http://x/things/1',
  method: 'GET',
  headers,
});
const res = <T>(data: T): ApiResponse<T> => ({
  data,
  status: 200,
  headers: {},
  fromCache: false,
});

describe('composeHooks (unit)', () => {
  it('chains transforming onRequest across layers in order', async () => {
    const hooks = composeHooks([
      { onRequest: (r) => ({ ...r, headers: { ...r.headers, a: '1' } }) },
      { onRequest: (r) => ({ ...r, headers: { ...r.headers, b: '2' } }) },
      { onRequest: (r) => ({ ...r, headers: { ...r.headers, c: '3' } }) },
    ]);
    const out = await hooks.onRequest(req());
    expect(out.headers).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('treats a void return from a transforming hook as pass-through', async () => {
    const hooks = composeHooks([
      { onRequest: (r) => ({ ...r, headers: { ...r.headers, a: '1' } }) },
      { onRequest: () => undefined },
      { onRequest: (r) => ({ ...r, headers: { ...r.headers, c: '3' } }) },
    ]);
    const out = await hooks.onRequest(req());
    expect(out.headers).toEqual({ a: '1', c: '3' });
  });

  it('fans out notification hooks in order (global -> module -> per-call)', async () => {
    const order: string[] = [];
    const hooks = composeHooks([
      { onSuccess: () => void order.push('global') },
      { onSuccess: () => void order.push('module') },
      { onSuccess: () => void order.push('perCall') },
    ]);
    await hooks.onSuccess(res(1));
    expect(order).toEqual(['global', 'module', 'perCall']);
  });

  it('isolates a throwing notification hook and reports it', async () => {
    const reported: string[] = [];
    const after = vi.fn();
    const hooks = composeHooks(
      [
        {
          onError: () => {
            throw new Error('boom');
          },
        },
        { onError: after },
      ],
      (hook) => reported.push(hook),
    );
    await expect(hooks.onError(new ApiError({ message: 'x' }))).resolves.toBeUndefined();
    expect(reported).toEqual(['onError']); // failure surfaced, not thrown
    expect(after).toHaveBeenCalledOnce(); // later hook still ran
  });

  it('returns a shared no-op set when no layer defines hooks', () => {
    const a = composeHooks([undefined, {}, undefined]);
    const b = composeHooks([]);
    expect(a).toBe(b);
  });
});

// --- Integration through the pipeline ------------------------------------

const things = {
  auto: false as const,
  things: {
    config: {
      hooks: {
        onRequest: (r: ApiRequest) => ({ ...r, headers: { ...r.headers, 'x-module': 'm' } }),
      },
    },
    methods: {
      get: async (ctx: ModuleContext, id: string, perCall?: PerCallConfig) =>
        (await ctx.request({ method: 'GET', path: '/things/{id}', pathParams: { id } }, perCall))
          .data,
    },
  },
};

interface ThingsApi {
  things: { get: (id: string, perCall?: PerCallConfig) => Promise<unknown> };
}

describe('hook composition through the pipeline', () => {
  it('fires global + module + per-call onRequest, accreting headers in order', async () => {
    let seen: Record<string, string> = {};
    const { api, mock } = createMockClient({
      hooks: { onRequest: (r) => ({ ...r, headers: { ...r.headers, 'x-global': 'g' } }) },
      modules: things,
    });
    mock.on('GET', '/things/1', (r) => {
      seen = r.headers;
      return { data: { id: '1' } };
    });

    await (api as unknown as ThingsApi).things.get('1', {
      hooks: { onRequest: (r: ApiRequest) => ({ ...r, headers: { ...r.headers, 'x-call': 'c' } }) },
    });

    expect(seen['x-global']).toBe('g');
    expect(seen['x-module']).toBe('m');
    expect(seen['x-call']).toBe('c');
  });

  it('fires onSuccess then onSettled exactly once on success', async () => {
    const events: string[] = [];
    const { api, mock } = createMockClient({
      hooks: {
        onSuccess: () => void events.push('success'),
        onSettled: (r, e) =>
          void events.push(`settled:${r ? 'res' : 'none'}:${e ? 'err' : 'none'}`),
      },
      modules: things,
    });
    mock.on('GET', '/things/1', { data: { id: '1' } });

    await (api as unknown as ThingsApi).things.get('1');
    expect(events).toEqual(['success', 'settled:res:none']);
  });

  it('fires onError then onSettled(error) exactly once on failure', async () => {
    const events: string[] = [];
    const { api, mock } = createMockClient({
      hooks: {
        onSuccess: () => void events.push('success'),
        onError: () => void events.push('error'),
        onSettled: (r, e) => void events.push(`settled:${e ? 'err' : 'none'}`),
      },
      modules: things,
    });
    mock.on('GET', '/things/9', () => ({ status: 500, data: { message: 'nope' } }));

    await expect((api as unknown as ThingsApi).things.get('9')).rejects.toBeInstanceOf(ApiError);
    expect(events).toEqual(['error', 'settled:err']);
  });
});
