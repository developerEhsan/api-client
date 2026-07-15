import { applyApiKey } from '../../auth/strategies/apiKey';
import { applyBearer } from '../../auth/strategies/bearer';
import { applyCookie } from '../../auth/strategies/cookie';
import { applyOAuth2 } from '../../auth/strategies/oauth2';
/**
 * Auth interceptor — resolves the configured {@link AuthConfig} into a concrete
 * {@link AuthContribution} (headers / query / cookie flag) for one request.
 * Pipeline lifecycle step 8 (spec §5).
 */
import type { AuthConfig, AuthContribution } from '../../types/auth.types';

function empty(): AuthContribution {
  return { headers: {}, query: {}, cookie: false };
}

function fold(base: AuthContribution, part: Partial<AuthContribution>): AuthContribution {
  return {
    headers: { ...base.headers, ...part.headers },
    query: { ...base.query, ...part.query },
    cookie: base.cookie || part.cookie === true,
  };
}

/**
 * Resolve the auth contribution for the given strategy. When `skip` is true
 * (per-call `skipAuth`, spec A8) no auth is applied.
 */
export async function applyAuth(auth: AuthConfig, skip: boolean): Promise<AuthContribution> {
  if (skip) return empty();

  switch (auth.strategy) {
    case 'bearer':
      return fold(empty(), await applyBearer(auth));
    case 'apiKey':
      return fold(empty(), await applyApiKey(auth));
    case 'oauth2':
      return fold(empty(), await applyOAuth2(auth));
    case 'cookie':
      return fold(empty(), applyCookie());
    default:
      return empty();
  }
}
