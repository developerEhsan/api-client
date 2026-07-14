import { AuthError } from '../../errors/AuthError';
/**
 * API-key auth strategy: injects a key into a custom header or query param.
 */
import type { ApiKeyAuthConfig, AuthContribution } from '../../types/auth.types';

export async function applyApiKey(config: ApiKeyAuthConfig): Promise<Partial<AuthContribution>> {
  let key: string;
  try {
    key = await config.getKey();
  } catch (cause) {
    throw new AuthError({ message: 'API key auth: getKey() threw.', cause });
  }

  if (config.placement === 'query') {
    return { query: { [config.name]: key } };
  }
  return { headers: { [config.name]: key } };
}
