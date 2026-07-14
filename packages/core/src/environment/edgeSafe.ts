import { ConfigurationError } from '../errors/ConfigurationError';
import type { DetectedEnvironment } from '../types/environment.types';

/** HTTP adapter identifiers supported by the client. */
export type AdapterName = 'axios' | 'fetch';

/**
 * Resolves the effective HTTP adapter for the detected environment.
 *
 * Per spec R1: when the runtime cannot support Axios (e.g. edge runtimes),
 * `'axios'` requests are downgraded to `'fetch'` with a `console.warn`.
 */
export function resolveAdapterName(requested: AdapterName, env: DetectedEnvironment): AdapterName {
  if (requested === 'axios' && !env.capabilities.supportsAxios) {
    console.warn(
      `[@developerEhsan/api-client] Axios adapter is not supported on the "${env.environment}" runtime; falling back to the fetch adapter.`,
    );
    return 'fetch';
  }
  return requested;
}

/**
 * Asserts that a usable `fetch` implementation is available in the current
 * environment. Throws {@link ConfigurationError} when it is absent.
 */
export function assertFetchAvailable(env: DetectedEnvironment): void {
  if (!env.capabilities.hasFetch) {
    throw new ConfigurationError(
      `The fetch adapter requires a global \`fetch\`, which is unavailable on the "${env.environment}" runtime. Provide a fetch polyfill or use the axios adapter.`,
    );
  }
}
