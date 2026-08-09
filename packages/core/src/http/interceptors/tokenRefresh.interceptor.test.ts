/**
 * OAuth2 refresh mechanisms (spec 05): the `refresh` callback alternative to
 * `refreshEndpoint`, and the construction-time guard for the "exactly one"
 * constraints module-level auth overrides can otherwise slip past the type
 * system.
 */
import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../errors/ConfigurationError';
import { createMockClient } from '../../testing/createMockClient';
import type { OAuth2AuthConfig } from '../../types/auth.types';
import type { ModuleContext } from '../../types/module.types';

function makeThingsApi(auth: OAuth2AuthConfig) {
  const { api, mock } = createMockClient({
    auth,
    modules: {
      auto: false as const,
      things: {
        methods: {
          get: async (ctx: ModuleContext, id: string) =>
            (await ctx.request({ method: 'GET', path: '/things/{id}', pathParams: { id } })).data,
        },
      },
    },
  });
  return { api: api as unknown as { things: { get: (id: string) => Promise<unknown> } }, mock };
}

describe('OAuth2 refresh: callback mechanism', () => {
  it('refresh() success updates tokens via onTokensRefreshed and retries once', async () => {
    const store = { access: 'expired', refresh: 'r1' };
    let refreshCalls = 0;
    const { api, mock } = makeThingsApi({
      strategy: 'oauth2',
      getAccessToken: () => store.access,
      getRefreshToken: () => store.refresh,
      refresh: async (refreshToken) => {
        refreshCalls += 1;
        expect(refreshToken).toBe('r1');
        return { accessToken: 'fresh', refreshToken: 'r2' };
      },
      onTokensRefreshed: (t) => {
        store.access = t.accessToken;
        store.refresh = t.refreshToken ?? store.refresh;
      },
      onRefreshFailed: () => {},
    });

    mock.on('GET', '/things/1', (r) => {
      const auth = r.headers['Authorization'] ?? r.headers['authorization'];
      return auth === 'Bearer fresh'
        ? { data: { id: '1' } }
        : { status: 401, data: { message: 'expired' } };
    });

    const result = await api.things.get('1');
    expect(result).toEqual({ id: '1' });
    expect(store.access).toBe('fresh');
    expect(refreshCalls).toBe(1);
  });

  it('concurrent 401s under "queue" coalesce onto one refresh() call', async () => {
    const store = { access: 'expired', refresh: 'r1' };
    let refreshCalls = 0;
    const { api, mock } = makeThingsApi({
      strategy: 'oauth2',
      getAccessToken: () => store.access,
      getRefreshToken: () => store.refresh,
      refresh: async () => {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 5));
        return { accessToken: 'fresh' };
      },
      onTokensRefreshed: (t) => {
        store.access = t.accessToken;
      },
      onRefreshFailed: () => {},
      concurrentRefreshStrategy: 'queue',
    });

    mock.on('GET', '/things/1', (r) => {
      const auth = r.headers['Authorization'] ?? r.headers['authorization'];
      return auth === 'Bearer fresh'
        ? { data: { id: '1' } }
        : { status: 401, data: { message: 'expired' } };
    });

    await Promise.all([api.things.get('1'), api.things.get('1'), api.things.get('1')]);
    expect(refreshCalls).toBe(1);
  });

  it('refresh() throwing surfaces through onRefreshFailed, never an unhandled rejection', async () => {
    const failures: unknown[] = [];
    const { api, mock } = makeThingsApi({
      strategy: 'oauth2',
      getAccessToken: () => 'expired',
      getRefreshToken: () => 'r1',
      refresh: async () => {
        throw new Error('sdk refresh boom');
      },
      onTokensRefreshed: () => {},
      onRefreshFailed: (err) => {
        failures.push(err);
      },
    });
    mock.on('GET', '/things/1', { status: 401, data: {} });

    await expect(api.things.get('1')).rejects.toBeTruthy();
    expect(failures).toHaveLength(1);
  });

  it("a malformed refresh() return (no accessToken) fails via onRefreshFailed, never proceeds with undefined", async () => {
    const failures: unknown[] = [];
    const { api, mock } = makeThingsApi({
      strategy: 'oauth2',
      getAccessToken: () => 'expired',
      getRefreshToken: () => 'r1',
      // biome-ignore lint/suspicious/noExplicitAny: intentionally malformed for the test
      refresh: async () => ({}) as any,
      onTokensRefreshed: () => {},
      onRefreshFailed: (err) => {
        failures.push(err);
      },
    });
    mock.on('GET', '/things/1', { status: 401, data: {} });

    await expect(api.things.get('1')).rejects.toBeTruthy();
    expect(failures).toHaveLength(1);
  });
});

describe('OAuth2 config validation (defense-in-depth)', () => {
  it('throws ConfigurationError at client construction when both refreshEndpoint and refresh are set', () => {
    expect(() =>
      makeThingsApi({
        strategy: 'oauth2',
        getAccessToken: () => 'a',
        getRefreshToken: () => 'r',
        refreshEndpoint: 'https://auth.test/token',
        refresh: async () => ({ accessToken: 'x' }),
        onTokensRefreshed: () => {},
        onRefreshFailed: () => {},
      } as unknown as OAuth2AuthConfig),
    ).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError at client construction when neither refreshEndpoint nor refresh is set', () => {
    expect(() =>
      makeThingsApi({
        strategy: 'oauth2',
        getAccessToken: () => 'a',
        getRefreshToken: () => 'r',
        onTokensRefreshed: () => {},
        onRefreshFailed: () => {},
      } as unknown as OAuth2AuthConfig),
    ).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError when both tokenStorage and the manual triplet are set', () => {
    expect(() =>
      makeThingsApi({
        strategy: 'oauth2',
        refreshEndpoint: 'https://auth.test/token',
        onRefreshFailed: () => {},
        getAccessToken: () => 'a',
        getRefreshToken: () => 'r',
        onTokensRefreshed: () => {},
        tokenStorage: { getTokens: () => null, setTokens: () => {}, clearTokens: () => {} },
      } as unknown as OAuth2AuthConfig),
    ).toThrow(ConfigurationError);
  });

  it('throws ConfigurationError when neither tokenStorage nor the manual triplet is set', () => {
    expect(() =>
      makeThingsApi({
        strategy: 'oauth2',
        refreshEndpoint: 'https://auth.test/token',
        onRefreshFailed: () => {},
      } as unknown as OAuth2AuthConfig),
    ).toThrow(ConfigurationError);
  });
});
