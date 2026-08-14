import {
  extractRefreshedTokens,
  refreshFailure,
  resolveTokenSource,
  validateOAuth2Config,
} from '../../auth/strategies/oauth2';
import { ApiError } from '../../errors/ApiError';
import { AuthError } from '../../errors/AuthError';
import type { ClassifierInput } from '../../errors/errorClassifier';
/**
 * Token-refresh interceptor. On a 401 the OAuth2 refresh flow fires here,
 * guarded by a mutex so concurrent 401s trigger exactly one refresh (spec 6.2:
 * multiple simultaneous 401s wait on the same promise).
 */
import type { OAuth2AuthConfig, OAuth2Tokens } from '../../types/auth.types';
import type { ApiRequest } from '../../types/http.types';
import type { HttpAdapter } from '../adapters/adapterInterface';

export interface TokenRefresherDeps {
  adapter: HttpAdapter;
  classifyError: (input: ClassifierInput) => ApiError;
}

export interface TokenRefresher {
  /**
   * Attempt to refresh the access token. Resolves `true` when new tokens were
   * obtained (caller should retry the original request once) and `false` when
   * refresh was not possible or failed (caller should surface the 401).
   */
  refresh(config: OAuth2AuthConfig): Promise<boolean>;
}

export function createTokenRefresher(deps: TokenRefresherDeps): TokenRefresher {
  const { adapter, classifyError } = deps;

  // Mutex: the in-flight refresh promise under the default 'queue' strategy,
  // keyed by the OAuth2 config so distinct per-module configs don't coalesce
  // onto each other's refresh (they refresh independently).
  const inflightByConfig = new WeakMap<OAuth2AuthConfig, Promise<boolean>>();

  async function performHttpRefresh(
    config: OAuth2AuthConfig & { refreshEndpoint: string },
    refreshToken: string,
  ): Promise<OAuth2Tokens> {
    const payload = config.refreshPayload
      ? config.refreshPayload(refreshToken)
      : { refresh_token: refreshToken };

    const request: ApiRequest = {
      url: config.refreshEndpoint,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      responseType: 'json',
      meta: { skipAuth: true },
    };

    let raw: Awaited<ReturnType<typeof adapter.send>>;
    try {
      raw = await adapter.send(request);
    } catch (cause) {
      throw classifyError({ kind: 'network', cause, request });
    }

    // Refresh endpoint itself errored (401/403 expired token, 429 rate-limited).
    if (raw.status >= 400) {
      throw classifyError({
        kind: 'http',
        status: raw.status,
        statusText: raw.statusText,
        headers: raw.headers,
        data: raw.data,
        request,
      });
    }

    const tokens = extractRefreshedTokens(raw.data);
    if (!tokens) {
      throw refreshFailure('Refresh response contained no access token.');
    }
    return tokens;
  }

  async function performRefresh(config: OAuth2AuthConfig): Promise<boolean> {
    validateOAuth2Config(config);
    const { getRefreshToken, onTokensRefreshed } = resolveTokenSource(config);

    let refreshToken: string | null;
    try {
      refreshToken = await getRefreshToken();
    } catch (cause) {
      await config.onRefreshFailed(refreshFailure('getRefreshToken() threw.', cause));
      return false;
    }

    // Refresh token missing/null -> fail immediately without a network call.
    if (!refreshToken) {
      await config.onRefreshFailed(refreshFailure('No refresh token available.'));
      return false;
    }

    let tokens: OAuth2Tokens;
    try {
      tokens = config.refresh
        ? await config.refresh(refreshToken)
        : await performHttpRefresh(
            config as OAuth2AuthConfig & { refreshEndpoint: string },
            refreshToken,
          );
    } catch (cause) {
      const error =
        cause instanceof AuthError || cause instanceof ApiError
          ? (cause as ApiError)
          : refreshFailure('refresh() threw.', cause);
      await config.onRefreshFailed(error);
      return false;
    }

    // Validate the callback path's return value the same way an HTTP JSON
    // response is shape-checked — a malformed return must never silently
    // proceed with `undefined` as the new access token.
    if (typeof tokens?.accessToken !== 'string' || tokens.accessToken.length === 0) {
      await config.onRefreshFailed(
        refreshFailure('refresh() resolved without a valid accessToken.'),
      );
      return false;
    }

    await onTokensRefreshed(tokens);
    return true;
  }

  return {
    refresh(config: OAuth2AuthConfig): Promise<boolean> {
      const strategy = config.concurrentRefreshStrategy ?? 'queue';

      // 'race' allows concurrent refreshes; 'queue' coalesces onto one — but
      // only among calls sharing the SAME config.
      if (strategy === 'queue') {
        const existing = inflightByConfig.get(config);
        if (existing) return existing;
      }

      const promise = performRefresh(config);
      if (strategy === 'queue') {
        inflightByConfig.set(config, promise);
        void promise.finally(() => {
          if (inflightByConfig.get(config) === promise) inflightByConfig.delete(config);
        });
      }
      return promise;
    },
  };
}
