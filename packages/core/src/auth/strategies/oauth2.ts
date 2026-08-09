import { AuthError } from '../../errors/AuthError';
import { ConfigurationError } from '../../errors/ConfigurationError';
/**
 * OAuth2 auth strategy. Request-time injection lives here; the 401 -> refresh
 * -> retry flow (mutex-locked) lives in the token-refresh interceptor.
 */
import type { AuthContribution, OAuth2AuthConfig, OAuth2Tokens } from '../../types/auth.types';

/**
 * Defense-in-depth runtime check for the "exactly one" constraints the type
 * system already enforces at the top level (spec 05) — module-level auth
 * overrides aren't type-checked against the global shape, so this guard
 * catches a misconfigured `refreshEndpoint`+`refresh` or
 * `tokenStorage`+manual-triplet combination wherever it's actually used,
 * rather than silently picking one.
 */
export function validateOAuth2Config(config: OAuth2AuthConfig): void {
  const hasEndpoint = config.refreshEndpoint !== undefined;
  const hasCallback = config.refresh !== undefined;
  if (hasEndpoint === hasCallback) {
    throw new ConfigurationError(
      'auth strategy "oauth2" requires EXACTLY ONE of "refreshEndpoint" or "refresh".',
    );
  }
  const hasStorage = config.tokenStorage !== undefined;
  const hasManual = config.getAccessToken !== undefined || config.getRefreshToken !== undefined;
  if (hasStorage === hasManual) {
    throw new ConfigurationError(
      'auth strategy "oauth2" requires EXACTLY ONE of "tokenStorage" or the manual ' +
        '"getAccessToken"/"getRefreshToken"/"onTokensRefreshed" triplet.',
    );
  }
}

/**
 * Resolve the effective token-source functions, deriving them from
 * `tokenStorage` when present so the rest of the flow (request-time
 * injection, refresh) never needs to branch on which was configured.
 */
export function resolveTokenSource(config: OAuth2AuthConfig): {
  getAccessToken: () => string | null | Promise<string | null>;
  getRefreshToken: () => string | null | Promise<string | null>;
  onTokensRefreshed: (tokens: OAuth2Tokens) => void | Promise<void>;
} {
  if (config.tokenStorage) {
    const storage = config.tokenStorage;
    return {
      getAccessToken: async () => (await storage.getTokens())?.accessToken ?? null,
      getRefreshToken: async () => (await storage.getTokens())?.refreshToken ?? null,
      onTokensRefreshed: (tokens) => storage.setTokens(tokens),
    };
  }
  return {
    getAccessToken: config.getAccessToken as () => string | null | Promise<string | null>,
    getRefreshToken: config.getRefreshToken as () => string | null | Promise<string | null>,
    onTokensRefreshed: config.onTokensRefreshed as (tokens: OAuth2Tokens) => void | Promise<void>,
  };
}

/**
 * Inject the current access token as a bearer header. When no access token is
 * available the request is sent unauthenticated — the server's 401 is what
 * triggers the refresh flow.
 */
export async function applyOAuth2(config: OAuth2AuthConfig): Promise<Partial<AuthContribution>> {
  validateOAuth2Config(config);
  const { getAccessToken } = resolveTokenSource(config);
  let token: string | null;
  try {
    token = await getAccessToken();
  } catch (cause) {
    throw new AuthError({
      message: 'OAuth2 auth: getAccessToken() threw.',
      cause,
    });
  }
  if (token) return { headers: { Authorization: `Bearer ${token}` } };
  return {};
}

/**
 * Extract tokens from a refresh-endpoint response body. Accepts both camelCase
 * (`accessToken`) and snake_case (`access_token`) conventions. Returns null when
 * no access token can be found.
 */
export function extractRefreshedTokens(data: unknown): OAuth2Tokens | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const access = record['accessToken'] ?? record['access_token'];
  if (typeof access !== 'string' || access.length === 0) return null;
  const refresh = record['refreshToken'] ?? record['refresh_token'];
  const tokens: OAuth2Tokens = { accessToken: access };
  if (typeof refresh === 'string' && refresh.length > 0) tokens.refreshToken = refresh;
  return tokens;
}

/** Build the AuthError raised when a refresh cannot proceed or fails. */
export function refreshFailure(message: string, cause?: unknown): AuthError {
  return new AuthError({ message, code: 'refresh_failed', cause });
}
