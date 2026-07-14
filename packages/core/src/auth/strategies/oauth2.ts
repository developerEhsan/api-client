import { AuthError } from '../../errors/AuthError';
/**
 * OAuth2 auth strategy. Request-time injection lives here; the 401 -> refresh
 * -> retry flow (mutex-locked) lives in the token-refresh interceptor.
 */
import type { AuthContribution, OAuth2AuthConfig, OAuth2Tokens } from '../../types/auth.types';

/**
 * Inject the current access token as a bearer header. When no access token is
 * available the request is sent unauthenticated — the server's 401 is what
 * triggers the refresh flow.
 */
export async function applyOAuth2(config: OAuth2AuthConfig): Promise<Partial<AuthContribution>> {
  let token: string | null;
  try {
    token = await config.getAccessToken();
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
