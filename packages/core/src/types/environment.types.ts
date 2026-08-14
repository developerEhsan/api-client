/**
 * Runtime environment detection & platform capability types.
 */

export type Environment = 'browser' | 'node' | 'edge' | 'nextjs-server' | 'nextjs-client';

/**
 * What the detected runtime can do — used to decide adapter selection (axios
 * vs fetch) and whether tenant-context propagation via `AsyncLocalStorage`
 * is available.
 *
 * @example
 * const caps: PlatformCapabilities = {
 *   supportsAxios: false,
 *   supportsAsyncLocalStorage: false,
 *   hasDom: false,
 *   hasFetch: true,
 *   hasVisibilityApi: false,
 * }
 *
 * @see {@link https://github.com/developerEhsan/api-client/blob/master/docs/environments.md}
 */
export interface PlatformCapabilities {
  /** Whether the Axios adapter can be used (false on edge runtimes). */
  supportsAxios: boolean;
  /** Whether `AsyncLocalStorage` is available (server runtimes). */
  supportsAsyncLocalStorage: boolean;
  /** Whether browser APIs (`window`, `document`, `localStorage`) are present. */
  hasDom: boolean;
  /** Whether the global `fetch` is available. */
  hasFetch: boolean;
  /** Whether the runtime can access `visibilitychange` events. */
  hasVisibilityApi: boolean;
}

/**
 * The result of runtime environment detection: which {@link Environment} the
 * client is running in and what it can do there. Read via `api.getSchema()`'s
 * sibling internals or by calling the environment detector directly.
 *
 * @example
 * function logEnv(detected: DetectedEnvironment): void {
 *   console.log(detected.environment, detected.capabilities.supportsAxios);
 * }
 *
 * @see {@link https://github.com/developerEhsan/api-client/blob/master/docs/environments.md}
 */
export interface DetectedEnvironment {
  environment: Environment;
  capabilities: PlatformCapabilities;
}
