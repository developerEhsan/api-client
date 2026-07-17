/**
 * Comprehensive end-to-end scenario suite (Phase 8). Exercises every major
 * feature through the real pipeline against a mock adapter, plus a full RPC
 * bridge round-trip. Feature-specific unit tests live next to each module; this
 * file is the integration safety net that proves the pieces work together.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRpcClient } from './browser/createRpcClient';
import { serverActionTransport } from './browser/transports';
import { createMemoryPersistentStore } from './cache-stores/index';
import { ApiError } from './errors/ApiError';
import { AuthError } from './errors/AuthError';
import { TimeoutError } from './errors/TimeoutError';
import { createRpcHandler } from './server/createRpcHandler';
import { createRateLimiter } from './server/rateLimit';
import { createMockClient } from './testing/createMockClient';
import type { MockAdapter, MockResponse } from './testing/mockAdapter';
import type { GlobalConfig, PerCallConfig } from './types/config.types';
import type { ApiRequest } from './types/http.types';
import type { ModuleContext } from './types/module.types';

/** A responder that never resolves but rejects when its request signal aborts. */
function hangUntilAborted(request: ApiRequest): Promise<MockResponse> {
  return new Promise((_resolve, reject) => {
    request.signal?.addEventListener(
      'abort',
      () => reject(new DOMException('The operation was aborted.', 'AbortError')),
      { once: true },
    );
  });
}

/** Standard test module surface used across scenarios. */
function makeModules() {
  return {
    auto: false as const,
    things: {
      methods: {
        get: async (ctx: ModuleContext, id: string, perCall?: PerCallConfig) =>
          (await ctx.request({ method: 'GET', path: '/things/{id}', pathParams: { id } }, perCall))
            .data,
        list: async (ctx: ModuleContext, perCall?: PerCallConfig) =>
          (await ctx.request({ method: 'GET', path: '/things' }, perCall)).data,
        create: async (ctx: ModuleContext, body: { name: string }) =>
          (await ctx.request({ method: 'POST', path: '/things', body })).data,
        slow: async (ctx: ModuleContext, perCall?: PerCallConfig) =>
          (await ctx.request({ method: 'GET', path: '/slow' }, perCall)).data,
      },
    },
  };
}

interface ThingsApi {
  things: {
    get: (id: string, perCall?: unknown) => Promise<unknown>;
    list: (perCall?: unknown) => Promise<unknown>;
    create: (body: { name: string }) => Promise<unknown>;
    slow: (perCall?: unknown) => Promise<unknown>;
  };
}

function make(config: Partial<Omit<GlobalConfig, 'openapi'>> = {}): {
  api: ThingsApi;
  raw: ReturnType<typeof createMockClient>['api'];
  mock: MockAdapter;
} {
  const { api, mock } = createMockClient({ modules: makeModules(), ...config });
  return { api: api as unknown as ThingsApi, raw: api, mock };
}

// ---------------------------------------------------------------------------
// Config & hooks (3-level layering + full lifecycle)
// ---------------------------------------------------------------------------

describe('E2E · hooks lifecycle', () => {
  it('fires onRequest (chained) -> onSuccess -> onSettled on success', async () => {
    const events: string[] = [];
    const { api, mock } = make({
      hooks: {
        onRequest: (r) => {
          events.push('req');
          return { ...r, headers: { ...r.headers, 'x-g': '1' } };
        },
        onResponse: (r) => {
          events.push('res');
          return r;
        },
        onSuccess: () => void events.push('success'),
        onSettled: (r, e) => void events.push(`settled:${r ? 'ok' : e ? 'err' : 'none'}`),
      },
    });
    let sawHeader: string | undefined;
    mock.on('GET', '/things/1', (r) => {
      sawHeader = r.headers['x-g'];
      return { data: { id: '1' } };
    });
    await api.things.get('1');
    expect(events).toEqual(['req', 'res', 'success', 'settled:ok']);
    expect(sawHeader).toBe('1');
  });

  it('fires onError -> onSettled(err) on failure', async () => {
    const events: string[] = [];
    const { api, mock } = make({
      hooks: {
        onError: () => void events.push('error'),
        onSettled: (_r, e) => void events.push(`settled:${e ? 'err' : 'ok'}`),
      },
    });
    mock.on('GET', '/things/9', { status: 500, data: { message: 'boom' } });
    await expect(api.things.get('9')).rejects.toBeInstanceOf(ApiError);
    expect(events).toEqual(['error', 'settled:err']);
  });
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe('E2E · auth', () => {
  it('bearer injects the Authorization header', async () => {
    const { api, mock } = make({ auth: { strategy: 'bearer', getToken: () => 'tok123' } });
    let auth: string | undefined;
    mock.on('GET', '/things/1', (r) => {
      auth = r.headers['Authorization'] ?? r.headers['authorization'];
      return { data: {} };
    });
    await api.things.get('1');
    expect(auth).toBe('Bearer tok123');
  });

  it('apiKey placement header vs query', async () => {
    const header = make({
      auth: { strategy: 'apiKey', getKey: () => 'k', placement: 'header', name: 'X-Key' },
    });
    header.mock.on('GET', '/things/1', (r) => {
      expect(r.headers['X-Key'] ?? r.headers['x-key']).toBe('k');
      return { data: {} };
    });
    await header.api.things.get('1');

    const query = make({
      auth: { strategy: 'apiKey', getKey: () => 'k', placement: 'query', name: 'api_key' },
    });
    let url = '';
    query.mock.on('GET', '/things/1', (r) => {
      url = r.url;
      return { data: {} };
    });
    await query.api.things.get('1');
    expect(url).toContain('api_key=k');
  });

  it('oauth2 does 401 -> refresh -> retry-once and persists new tokens', async () => {
    const store = { access: 'expired', refresh: 'r1' };
    let refreshed = false;
    const { api, mock } = make({
      auth: {
        strategy: 'oauth2',
        getAccessToken: () => store.access,
        getRefreshToken: () => store.refresh,
        refreshEndpoint: 'https://auth.test/token',
        onTokensRefreshed: (t) => {
          store.access = t.accessToken;
        },
        onRefreshFailed: () => {},
      },
    });
    // The protected endpoint 401s with the expired token, 200s once refreshed.
    mock.on('GET', '/things/1', (r) => {
      const auth = r.headers['Authorization'] ?? r.headers['authorization'];
      if (auth === 'Bearer fresh') return { data: { id: '1' } };
      return { status: 401, data: { message: 'expired' } };
    });
    mock.on('POST', 'https://auth.test/token', () => {
      refreshed = true;
      return { data: { access_token: 'fresh', refresh_token: 'r2' } };
    });

    const result = await api.things.get('1');
    expect(refreshed).toBe(true);
    expect(store.access).toBe('fresh');
    expect(result).toEqual({ id: '1' });
  });

  it('raises AuthError when a 401 cannot be refreshed', async () => {
    const { api, mock } = make({ auth: { strategy: 'bearer', getToken: () => 'x' } });
    mock.on('GET', '/things/1', { status: 401, data: { message: 'nope' } });
    await expect(api.things.get('1')).rejects.toBeInstanceOf(AuthError);
  });
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

describe('E2E · caching', () => {
  it('cache-first serves the second identical GET from cache', async () => {
    const { api, mock } = make({ cache: { strategy: 'cache-first', ttl: 60_000 } });
    let hits = 0;
    mock.on('GET', '/things/1', () => {
      hits++;
      return { data: { id: '1' } };
    });
    await api.things.get('1');
    await api.things.get('1');
    expect(hits).toBe(1);
  });

  it('network-first falls back to cache when the network fails', async () => {
    const { api, raw, mock } = make({ cache: { strategy: 'network-first', ttl: 60_000 } });
    let ok = true;
    mock.on('GET', '/things/1', () => (ok ? { data: { id: '1' } } : { status: 500, data: {} }));
    await api.things.get('1'); // primes the cache
    ok = false;
    const fallback = await api.things.get('1'); // network 500 -> cached value
    expect(fallback).toEqual({ id: '1' });
    // Glob invalidation drops the entry.
    (raw as unknown as { cache: { invalidate: (p: string) => void } }).cache.invalidate('*');
    await expect(api.things.get('1')).rejects.toBeInstanceOf(ApiError);
  });

  it('stale-while-revalidate serves stale immediately then refreshes', async () => {
    const { api, mock } = make({ cache: { strategy: 'stale-while-revalidate', ttl: 0 } });
    let version = 1;
    mock.on('GET', '/things/1', () => ({ data: { v: version } }));
    const first = await api.things.get('1');
    expect(first).toEqual({ v: 1 });
    version = 2;
    // ttl:0 => entry immediately stale; this returns stale (v1) and revalidates.
    const second = await api.things.get('1');
    expect(second).toEqual({ v: 1 });
    // Background revalidation eventually refreshes the cached value to v2.
    await vi.waitFor(async () => expect(await api.things.get('1')).toEqual({ v: 2 }), {
      timeout: 1000,
    });
  });

  it('per-call cache bust forces a fresh fetch', async () => {
    const { api, mock } = make({ cache: { strategy: 'cache-first', ttl: 60_000 } });
    let hits = 0;
    mock.on('GET', '/things/1', () => {
      hits++;
      return { data: { id: '1' } };
    });
    await api.things.get('1');
    await api.things.get('1', { cache: { bust: true } });
    expect(hits).toBe(2);
  });

  it('persistentStore receives write-through on a cached GET', async () => {
    const l2 = createMemoryPersistentStore();
    const setSpy = vi.spyOn(l2, 'set');
    const { api, mock } = make({
      cache: { strategy: 'cache-first', ttl: 60_000, persistentStore: l2 },
    });
    mock.on('GET', '/things/1', { data: { id: '1' } });
    await api.things.get('1');
    await Promise.resolve();
    expect(setSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

describe('E2E · dedup', () => {
  it('coalesces concurrent identical GETs into one network call', async () => {
    const { api, mock } = make();
    let hits = 0;
    mock.on('GET', '/things/1', async () => {
      hits++;
      await new Promise((r) => setTimeout(r, 10));
      return { data: { id: '1' } };
    });
    await Promise.all([api.things.get('1'), api.things.get('1'), api.things.get('1')]);
    expect(hits).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Retry / timeout / cancellation
// ---------------------------------------------------------------------------

describe('E2E · retry / timeout / cancellation', () => {
  it('retries a 503 then succeeds', async () => {
    const { api, mock } = make({
      http: { retry: { attempts: 3, baseDelay: 0, maxDelay: 0, jitter: false } },
    });
    let n = 0;
    mock.on('GET', '/things/1', () => {
      n++;
      return n < 2 ? { status: 503, data: {} } : { data: { id: '1' } };
    });
    expect(await api.things.get('1')).toEqual({ id: '1' });
    expect(n).toBe(2);
  });

  it('raises TimeoutError when the response exceeds the per-call timeout', async () => {
    const { api, mock } = make();
    mock.on('GET', '/slow', hangUntilAborted);
    await expect(api.things.slow({ timeout: 20 })).rejects.toBeInstanceOf(TimeoutError);
  });

  it('an aborted signal rejects with an AbortError (not swallowed)', async () => {
    const { api, mock } = make();
    mock.on('GET', '/slow', hangUntilAborted);
    const controller = new AbortController();
    const promise = api.things.slow({ signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

describe('E2E · tenancy', () => {
  it('injects the tenant header and scopes the cache per tenant', async () => {
    let current = 'acme';
    const { api, mock } = make({
      tenancy: { headerName: 'X-Tenant-ID', getTenantId: () => current },
      cache: { strategy: 'cache-first', ttl: 60_000 },
    });
    const seen: string[] = [];
    mock.on('GET', '/things/1', (r) => {
      seen.push(r.headers['X-Tenant-ID'] ?? r.headers['x-tenant-id'] ?? '');
      return { data: { id: '1' } };
    });
    await api.things.get('1'); // acme -> network
    current = 'globex';
    await api.things.get('1'); // globex -> different cache scope -> network
    expect(seen).toEqual(['acme', 'globex']);
  });
});

// ---------------------------------------------------------------------------
// safeMode
// ---------------------------------------------------------------------------

describe('E2E · safeMode', () => {
  it('returns a discriminated result instead of throwing', async () => {
    const { api: raw, mock } = createMockClient({ safeMode: true, modules: makeModules() });
    mock.on('GET', '/things/ok', { data: { id: 'ok' } });
    mock.on('GET', '/things/bad', { status: 500, data: { message: 'x' } });
    const api = raw as unknown as {
      things: {
        get: (id: string) => Promise<{ success: boolean; data?: unknown; error?: unknown }>;
      };
    };
    const good = await api.things.get('ok');
    expect(good).toMatchObject({ success: true, data: { id: 'ok' } });
    const bad = await api.things.get('bad');
    expect(bad).toMatchObject({ success: false });
    expect((bad as { error: unknown }).error).toBeInstanceOf(ApiError);
  });
});

// ---------------------------------------------------------------------------
// ctx.run (non-HTTP module logic)
// ---------------------------------------------------------------------------

describe('E2E · ctx.run', () => {
  it('runs arbitrary logic with retry through the shared infrastructure', async () => {
    const { api: raw } = createMockClient({
      modules: {
        auto: false as const,
        jobs: {
          methods: {
            compute: async (ctx: ModuleContext) => {
              let tries = 0;
              return ctx.run(
                'compute',
                async () => {
                  tries++;
                  if (tries < 2)
                    throw new (await import('./errors/NetworkError')).NetworkError({
                      message: 'flaky',
                    });
                  return tries;
                },
                { retry: { attempts: 3, baseDelay: 0, maxDelay: 0, jitter: false } },
              );
            },
          },
        },
      },
    });
    const api = raw as unknown as { jobs: { compute: () => Promise<number> } };
    expect(await api.jobs.compute()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// RPC bridge round-trip (handler + browser client over a direct transport)
// ---------------------------------------------------------------------------

describe('E2E · RPC bridge', () => {
  interface BridgeApi {
    pet: {
      getPetById: (input: { pathParams: { petId: number } }) => Promise<{ id: number }>;
      deletePet: () => Promise<unknown>;
    };
  }

  function makeBridge(rateLimited = false) {
    const realApi = {
      pet: {
        getPetById: (input: { pathParams: { petId: number } }) =>
          Promise.resolve({ id: input.pathParams.petId }),
        deletePet: () =>
          Promise.reject(new AuthError({ message: 'no', status: 401, code: 'unauthorized' })),
      },
    };
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    const handler = createRpcHandler(realApi, {
      expose: { pet: ['getPetById', 'deletePet'] },
      ...(rateLimited ? { onRequest: limiter.onRequest } : {}),
    });
    // A transport that calls the handler directly (single + batch envelopes).
    const transport = serverActionTransport((payload: unknown) =>
      payload && typeof payload === 'object' && '__rpcBatch' in payload
        ? handler.handleBatch(payload)
        : handler.handle(payload),
    );
    return { client: createRpcClient<BridgeApi>(transport, { batch: true }), handler };
  }

  it('round-trips a typed exposed call', async () => {
    const { client } = makeBridge();
    const pet = await client.pet.getPetById({ pathParams: { petId: 7 } });
    expect(pet).toEqual({ id: 7 });
  });

  it('rehydrates a real ApiError on the browser side', async () => {
    const { client } = makeBridge();
    await expect(client.pet.deletePet()).rejects.toBeInstanceOf(ApiError);
    await expect(client.pet.deletePet()).rejects.toMatchObject({ status: 401 });
  });

  it('coalesces same-tick calls into one batch and distributes results', async () => {
    const { client } = makeBridge();
    const [a, b] = await Promise.all([
      client.pet.getPetById({ pathParams: { petId: 1 } }),
      client.pet.getPetById({ pathParams: { petId: 2 } }),
    ]);
    expect([a, b]).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('enforces the rate limiter (429 rehydrated as ApiError)', async () => {
    const { handler } = makeBridge(true);
    const first = await handler.handle({
      module: 'pet',
      method: 'getPetById',
      args: [{ pathParams: { petId: 1 } }],
    });
    expect(first.ok).toBe(true);
    const second = await handler.handle({
      module: 'pet',
      method: 'getPetById',
      args: [{ pathParams: { petId: 1 } }],
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.status).toBe(429);
  });
});
