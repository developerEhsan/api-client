/**
 * Runtime environment detection & platform capability types.
 */

export type Environment = 'browser' | 'node' | 'edge' | 'nextjs-server' | 'nextjs-client';

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

export interface DetectedEnvironment {
  environment: Environment;
  capabilities: PlatformCapabilities;
}
