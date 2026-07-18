/**
 * Config introspection (A3) + create-time validation (A4) tests.
 */
import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../errors/ConfigurationError';
import { createMockClient } from '../testing/createMockClient';
import type { ModuleContext } from '../types/module.types';
import { createClient } from './createClient';

const modules = {
  auto: false as const,
  things: {
    config: { timeout: 1234, hooks: { onError: () => {} } },
    methods: {
      get: async (ctx: ModuleContext) => (await ctx.request({ method: 'GET', path: '/x' })).data,
    },
  },
};

describe('client.config.resolve (A3)', () => {
  it('reflects the effective merge (module wins over global, per-call wins over module)', () => {
    const { api } = createMockClient({
      http: { timeout: 5000 },
      auth: { strategy: 'bearer', getToken: () => 'secret-token' },
      modules,
    });
    expect(api.config.resolve().timeout).toBe(5000);
    expect(api.config.resolve('things').timeout).toBe(1234);
    expect(api.config.resolve('things', { timeout: 42 }).timeout).toBe(42);
  });

  it('redacts secrets: auth is reduced to strategy, hooks to a presence map', () => {
    const { api } = createMockClient({
      auth: { strategy: 'bearer', getToken: () => 'secret-token' },
      hooks: { onRequest: (r) => r },
      modules,
    });
    const snap = api.config.resolve('things', { hooks: { onSuccess: () => {} } });
    // No token or getter anywhere in the snapshot.
    expect(JSON.stringify(snap)).not.toContain('secret-token');
    expect(snap.auth).toEqual({ strategy: 'bearer' });
    // Hook presence aggregated across global (onRequest) + module (onError) + per-call (onSuccess).
    expect(snap.hooks.onRequest).toBe(true);
    expect(snap.hooks.onError).toBe(true);
    expect(snap.hooks.onSuccess).toBe(true);
    expect(snap.hooks.onResponse).toBe(false);
  });
});

describe('createClient validation (A4)', () => {
  const base = { baseURL: 'http://x', openapi: { mode: 'runtime' as const } };

  it('rejects a negative cache ttl', () => {
    expect(() => createClient({ ...base, cache: { ttl: -1 } })).toThrow(ConfigurationError);
  });

  it('rejects oauth2 without a refreshEndpoint', () => {
    expect(() =>
      createClient({
        ...base,
        auth: {
          strategy: 'oauth2',
          getAccessToken: () => '',
          getRefreshToken: () => '',
        } as never,
      }),
    ).toThrow(/refreshEndpoint/);
  });

  it('rejects stale-while-revalidate with cache disabled', () => {
    expect(() =>
      createClient({ ...base, cache: { enabled: false, strategy: 'stale-while-revalidate' } }),
    ).toThrow(ConfigurationError);
  });

  it('rejects a queue concurrency below 1', () => {
    expect(() => createClient({ ...base, http: { queue: { concurrency: 0 } } })).toThrow(
      ConfigurationError,
    );
  });

  it('accepts a sound config', () => {
    expect(() =>
      createClient({ ...base, cache: { ttl: 1000, strategy: 'stale-while-revalidate' } }),
    ).not.toThrow();
  });
});
