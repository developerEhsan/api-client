/**
 * Cookie auth strategy: sends credentials with the request. The adapter reads
 * `request.meta.cookieAuth` and sets `credentials: 'include'` (fetch) /
 * `withCredentials: true` (axios). The browser manages the cookie itself, so no
 * token getter is required (spec A10).
 */
import type { AuthContribution } from '../../types/auth.types'

export function applyCookie(): Partial<AuthContribution> {
  return { cookie: true }
}
