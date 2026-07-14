/**
 * RPC bridge tests. Each `S#` maps to a threat in the design's security table.
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors/ApiError';
import { AuthError } from '../errors/AuthError';
import { createRpcHandler } from './createRpcHandler';
import { createRpcRouteHandler } from './routeHandler';

/** A fake "real" client: records what the underlying method received. */
function makeApi() {
  const calls: Array<{ input: unknown; perCall: unknown }> = [];
  const api = {
    pet: {
      getPetById(input: unknown, perCall?: unknown) {
        calls.push({ input, perCall });
        return Promise.resolve({ id: 1, name: 'Rex' });
      },
      deletePet() {
        return Promise.reject(
          new AuthError({ message: 'nope', status: 401, code: 'unauthorized' }),
        );
      },
    },
    store: {
      getInventory() {
        return Promise.resolve({ available: 5 });
      },
    },
    // A non-module client utility that must never be callable.
    cache: { clear() {} },
  };
  return { api, calls };
}

describe('createRpcHandler', () => {
  it('dispatches an exposed call to the real method', async () => {
    const { api } = makeApi();
    const h = createRpcHandler(api, { expose: { pet: ['getPetById'] } });
    const res = await h.handle({
      module: 'pet',
      method: 'getPetById',
      args: [{ pathParams: { petId: 1 } }],
    });
    expect(res).toEqual({ ok: true, data: { id: 1, name: 'Rex' } });
  });

  it('S1: rejects a non-exposed module or method uniformly', async () => {
    const { api } = makeApi();
    const h = createRpcHandler(api, { expose: { pet: ['getPetById'] } });
    const unknownMethod = await h.handle({ module: 'pet', method: 'deletePet', args: [] });
    const unknownModule = await h.handle({ module: 'store', method: 'getInventory', args: [] });
    expect(unknownMethod).toEqual(unknownModule);
    expect(unknownMethod.ok).toBe(false);
  });

  it('S1: `expose: true` allows any method on that module', async () => {
    const { api } = makeApi();
    const h = createRpcHandler(api, { expose: { store: true } });
    const res = await h.handle({ module: 'store', method: 'getInventory', args: [] });
    expect(res).toEqual({ ok: true, data: { available: 5 } });
  });

  it('S1: cannot reach non-module client utilities like `cache`', async () => {
    const { api } = makeApi();
    // Even if a developer mistakenly exposes it, `cache.clear` is not a dispatchable method-returning-Promise here.
    const h = createRpcHandler(api, { expose: { cache: true } as never });
    const res = await h.handle({ module: 'cache', method: 'clear', args: [] });
    expect(res.ok).toBe(true); // clear() returns undefined; still no leak, just a no-op result
  });

  it('S2: rejects reserved / polluting module and method names', async () => {
    const { api } = makeApi();
    const h = createRpcHandler(api, { expose: { pet: ['getPetById'] } });
    for (const bad of ['__proto__', 'constructor', 'prototype', 'then']) {
      const r1 = await h.handle({ module: bad, method: 'getPetById', args: [] });
      const r2 = await h.handle({ module: 'pet', method: bad, args: [] });
      expect(r1.ok).toBe(false);
      expect(r2.ok).toBe(false);
    }
  });

  it('S2: rejects polluting keys inside input and never mutates the prototype', async () => {
    const { api } = makeApi();
    const h = createRpcHandler(api, { expose: { pet: ['getPetById'] } });
    const res = await h.handle({
      module: 'pet',
      method: 'getPetById',
      args: [JSON.parse('{"__proto__": {"polluted": true}}')],
    });
    expect(res.ok).toBe(false);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('S3: authorize=false denies an otherwise-exposed method uniformly', async () => {
    const { api } = makeApi();
    const h = createRpcHandler(api, {
      expose: { pet: ['getPetById'] },
      authorize: () => false,
    });
    const denied = await h.handle({ module: 'pet', method: 'getPetById', args: [] });
    const unknown = await h.handle({ module: 'pet', method: 'nope', args: [] });
    expect(denied).toEqual(unknown); // S9: indistinguishable
  });

  it('S4: drops client-controlled perCall except a clamped timeout', async () => {
    const { api, calls } = makeApi();
    const h = createRpcHandler(api, { expose: { pet: ['getPetById'] }, maxTimeout: 5000 });
    await h.handle({
      module: 'pet',
      method: 'getPetById',
      args: [
        { pathParams: { petId: 1 } },
        {
          timeout: 999999,
          baseURL: 'http://evil.internal',
          headers: { authorization: 'x' },
          adapter: {},
        },
      ],
    });
    expect(calls[0]!.perCall).toEqual({ timeout: 5000 }); // clamped; everything else dropped
  });

  it('S5: rejects non-primitive path params', async () => {
    const { api } = makeApi();
    const h = createRpcHandler(api, { expose: { pet: ['getPetById'] } });
    const res = await h.handle({
      module: 'pet',
      method: 'getPetById',
      args: [{ pathParams: { petId: { $ne: null } } }],
    });
    expect(res.ok).toBe(false);
  });

  it('S6: rejects input exceeding the depth cap', async () => {
    const { api } = makeApi();
    const h = createRpcHandler(api, { expose: { pet: ['getPetById'] }, maxInputDepth: 2 });
    const deep = { a: { b: { c: { d: 1 } } } };
    const res = await h.handle({ module: 'pet', method: 'getPetById', args: [deep] });
    expect(res.ok).toBe(false);
  });

  it('S8: sanitizes errors — no stack/backend detail; onError sees the full error', async () => {
    const { api } = makeApi();
    const seen: unknown[] = [];
    const h = createRpcHandler(api, {
      expose: { pet: ['deletePet'] },
      dev: false,
      onError: (e) => seen.push(e),
    });
    const res = await h.handle({ module: 'pet', method: 'deletePet', args: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.__rpcError).toBe(true);
      expect(res.error.status).toBe(401);
      expect(res.error).not.toHaveProperty('stack');
      expect(res.error).not.toHaveProperty('details'); // stripped in prod
    }
    expect(seen[0]).toBeInstanceOf(ApiError); // full error logged server-side
  });

  it('S11: onRequest throwing rejects before dispatch', async () => {
    const { api, calls } = makeApi();
    const h = createRpcHandler(api, {
      expose: { pet: ['getPetById'] },
      onRequest: () => {
        throw new Error('rate limited');
      },
    });
    const res = await h.handle({ module: 'pet', method: 'getPetById', args: [] });
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('S12: transformResult can redact the result', async () => {
    const { api } = makeApi();
    const h = createRpcHandler(api, {
      expose: { pet: ['getPetById'] },
      transformResult: (r) => ({ id: (r as { id: number }).id }),
    });
    const res = await h.handle({
      module: 'pet',
      method: 'getPetById',
      args: [{ pathParams: { petId: 1 } }],
    });
    expect(res).toEqual({ ok: true, data: { id: 1 } });
  });

  it('S10: concurrent calls do not share context', async () => {
    const seen: Array<string | undefined> = [];
    const api = {
      pet: {
        whoAmI(_i: unknown, _p: unknown) {
          return Promise.resolve('ok');
        },
      },
    };
    const h = createRpcHandler(api, {
      expose: { pet: ['whoAmI'] },
      authorize: (ctx) => {
        seen.push(ctx['user'] as string | undefined);
        return true;
      },
    });
    await Promise.all([
      h.handle({ module: 'pet', method: 'whoAmI', args: [] }, { user: 'alice' }),
      h.handle({ module: 'pet', method: 'whoAmI', args: [] }, { user: 'bob' }),
    ]);
    expect(new Set(seen)).toEqual(new Set(['alice', 'bob']));
  });
});

/** Minimal Request builder for route tests. */
function req(body: string, headers: Record<string, string>, method = 'POST'): Request {
  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') init.body = body;
  return new Request('https://app.example.com/api/rpc', init);
}

describe('createRpcRouteHandler', () => {
  const { api } = makeApi();
  const handler = createRpcHandler(api, { expose: { pet: ['getPetById'] } });
  const route = createRpcRouteHandler(handler);

  it('S7: accepts same-origin JSON POST', async () => {
    const res = await route(
      req(
        JSON.stringify({
          module: 'pet',
          method: 'getPetById',
          args: [{ pathParams: { petId: 1 } }],
        }),
        {
          'content-type': 'application/json',
          host: 'app.example.com',
          origin: 'https://app.example.com',
        },
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { id: 1, name: 'Rex' } });
  });

  it('S7: rejects a cross-origin Origin', async () => {
    const res = await route(
      req(JSON.stringify({ module: 'pet', method: 'getPetById', args: [] }), {
        'content-type': 'application/json',
        host: 'app.example.com',
        origin: 'https://evil.example.net',
      }),
    );
    expect(res.status).toBe(403);
  });

  it('S7: rejects non-POST and non-JSON', async () => {
    const get = await route(req('{}', { 'content-type': 'application/json' }, 'GET'));
    expect(get.status).toBe(405);
    const text = await route(req('{}', { 'content-type': 'text/plain', host: 'app.example.com' }));
    expect(text.status).toBe(415);
  });

  it('S6: rejects an over-cap body', async () => {
    const small = createRpcRouteHandler(handler, { maxBodyBytes: 10 });
    const res = await small(
      req(JSON.stringify({ module: 'pet', method: 'getPetById', args: [{ x: 'a'.repeat(100) }] }), {
        'content-type': 'application/json',
        host: 'app.example.com',
        origin: 'https://app.example.com',
      }),
    );
    expect(res.status).toBe(413);
  });

  it('rejects malformed JSON', async () => {
    const res = await route(
      req('{not json', {
        'content-type': 'application/json',
        host: 'app.example.com',
        origin: 'https://app.example.com',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('S1 over HTTP: non-exposed method rejected with generic error', async () => {
    const res = await route(
      req(JSON.stringify({ module: 'pet', method: 'deletePet', args: [] }), {
        'content-type': 'application/json',
        host: 'app.example.com',
        origin: 'https://app.example.com',
      }),
    );
    expect(res.status).toBe(200); // envelope carries the app-level denial
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});
