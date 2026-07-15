/**
 * Tenant id resolution with a fixed precedence (spec T3):
 *
 *   per-call  >  configured resolver (module- or global-level)  >  ambient
 *   AsyncLocalStorage context
 *
 * The module- vs global-level resolver distinction is already collapsed
 * upstream by `resolveRequestConfig` (module tenancy overrides global), so this
 * layer only sees the single effective `getTenantId`.
 */
import { ConfigurationError } from '../errors/ConfigurationError';
import { getTenantFromContext } from './tenantContext';

export interface TenantResolutionInput {
  /** Per-call override (highest precedence). */
  perCall?: string;
  /** Effective configured resolver (module override already applied). */
  getTenantId?: () => string | Promise<string>;
}

/**
 * Resolve the effective tenant id for a request.
 *
 * @throws {ConfigurationError} when the configured resolver throws (spec T2) —
 * surfaced synchronously-ish before the request is dispatched.
 * @returns the tenant id, or `undefined` when none is configured/resolved
 * (tenant-agnostic endpoints send no tenant header, spec T1).
 */
export async function resolveTenantId(input: TenantResolutionInput): Promise<string | undefined> {
  if (input.perCall !== undefined && input.perCall !== '') return input.perCall;

  if (typeof input.getTenantId === 'function') {
    let resolved: string;
    try {
      resolved = await input.getTenantId();
    } catch (cause) {
      throw new ConfigurationError(
        'tenancy.getTenantId() threw while resolving the tenant id.',
        cause,
      );
    }
    // A non-empty resolver result wins; an empty string means "unresolved"
    // (e.g. serverTenantResolver found no header) and falls through to context.
    if (resolved !== '') return resolved;
  }

  // Fall back to any ambient server-side tenant context.
  return getTenantFromContext();
}
