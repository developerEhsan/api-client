/**
 * Bearer token auth strategy: `Authorization: Bearer <token>`.
 */
import type { AuthContribution, BearerAuthConfig } from '../../types/auth.types'
import { AuthError } from '../../errors/AuthError'

/**
 * Resolve the bearer token and produce the auth contribution.
 *
 * Edge cases (spec 6.2):
 *  - A1 `getToken()` returns null -> behavior per `onMissingToken`
 *    ('throw' -> AuthError, 'skip'/'warn' -> send unauthenticated; default 'warn').
 *  - A2 `getToken()` throws -> wrapped in AuthError; request is NOT sent.
 */
export async function applyBearer(
  config: BearerAuthConfig,
): Promise<Partial<AuthContribution>> {
  let token: string | null
  try {
    token = await config.getToken()
  } catch (cause) {
    throw new AuthError({ message: 'Bearer auth: getToken() threw.', cause })
  }

  if (token) {
    const header = config.headerName ?? 'Authorization'
    const prefix = config.prefix ?? 'Bearer'
    return { headers: { [header]: prefix ? `${prefix} ${token}` : token } }
  }

  const mode = config.onMissingToken ?? 'warn'
  if (mode === 'throw') {
    throw new AuthError({ message: 'Bearer auth: getToken() returned no token.' })
  }
  if (mode === 'warn') {
    console.warn(
      '[@developerEhsan/api-client] Bearer auth: no token available; sending unauthenticated.',
    )
  }
  return {}
}
