import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '../errors/ConfigurationError';
import { createMockClient } from '../testing/createMockClient';
import type { OAuth2AuthConfig } from '../types/auth.types';
import { validateOAuth2Config } from './strategies/oauth2';
import { createLocalStorageTokenStorage, createMemoryTokenStorage } from './tokenStorage';

describe('createMemoryTokenStorage', () => {
  it('round-trips tokens correctly', async () => {
    const storage = createMemoryTokenStorage();
    expect(await storage.getTokens()).toBeNull();
    await storage.setTokens({ accessToken: 'a', refreshToken: 'r' });
    expect(await storage.getTokens()).toEqual({ accessToken: 'a', refreshToken: 'r' });
    await storage.clearTokens();
    expect(await storage.getTokens()).toBeNull();
  });
});

describe('createLocalStorageTokenStorage', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips tokens correctly', async () => {
    const storage = createLocalStorageTokenStorage({ key: 'test-tokens' });
    expect(await storage.getTokens()).toBeNull();
    await storage.setTokens({ accessToken: 'a', refreshToken: 'r' });
    expect(await storage.getTokens()).toEqual({ accessToken: 'a', refreshToken: 'r' });
    await storage.clearTokens();
    expect(await storage.getTokens()).toBeNull();
  });

  it('no-ops (never throws) when localStorage is unavailable', async () => {
    vi.stubGlobal('localStorage', undefined);
    const storage = createLocalStorageTokenStorage();
    expect(await storage.getTokens()).toBeNull();
    expect(() => storage.setTokens({ accessToken: 'a' })).not.toThrow();
    expect(() => storage.clearTokens()).not.toThrow();
  });

  it('ignores corrupt stored JSON', async () => {
    store['developerehsan-api-tokens'] = 'not json';
    const storage = createLocalStorageTokenStorage();
    expect(await storage.getTokens()).toBeNull();
  });
});

describe('tokenStorage vs manual triplet — construction-time validation', () => {
  it('tokenStorage + manual getters both set -> ConfigurationError', () => {
    const auth = {
      strategy: 'oauth2',
      refreshEndpoint: 'https://auth.test/token',
      onRefreshFailed: () => {},
      getAccessToken: () => 'a',
      getRefreshToken: () => 'r',
      onTokensRefreshed: () => {},
      tokenStorage: createMemoryTokenStorage(),
    } as unknown as OAuth2AuthConfig;

    expect(() => validateOAuth2Config(auth)).toThrow(ConfigurationError);
    expect(() => createMockClient({ auth })).toThrow(ConfigurationError);
  });

  it('tokenStorage alone derives getAccessToken/getRefreshToken/onTokensRefreshed and works end to end', async () => {
    const storage = createMemoryTokenStorage();
    await storage.setTokens({ accessToken: 'expired', refreshToken: 'r1' });

    const { api, mock } = createMockClient({
      auth: {
        strategy: 'oauth2',
        tokenStorage: storage,
        refresh: async () => ({ accessToken: 'fresh', refreshToken: 'r2' }),
        onRefreshFailed: () => {},
      } as unknown as OAuth2AuthConfig,
      modules: {
        auto: false as const,
        things: {
          methods: {
            get: async (ctx, id: string) =>
              (await ctx.request({ method: 'GET', path: '/things/{id}', pathParams: { id } })).data,
          },
        },
      },
    });

    mock.on('GET', '/things/1', (r) => {
      const authHeader = r.headers['Authorization'] ?? r.headers['authorization'];
      return authHeader === 'Bearer fresh'
        ? { data: { id: '1' } }
        : { status: 401, data: {} };
    });

    const typedApi = api as unknown as { things: { get: (id: string) => Promise<unknown> } };
    const result = await typedApi.things.get('1');
    expect(result).toEqual({ id: '1' });
    expect(await storage.getTokens()).toEqual({ accessToken: 'fresh', refreshToken: 'r2' });
  });
});
