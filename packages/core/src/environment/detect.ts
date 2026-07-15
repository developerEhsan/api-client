import type {
  DetectedEnvironment,
  Environment,
  PlatformCapabilities,
} from '../types/environment.types';

/** Narrow `globalThis` reads without leaking `any`. */
function getGlobal(key: string): unknown {
  return (globalThis as Record<string, unknown>)[key];
}

/** True when the current runtime is a known edge runtime (Cloudflare, Vercel Edge). */
function isEdgeRuntime(): boolean {
  if (getGlobal('EdgeRuntime') !== undefined) return true;
  const nav = getGlobal('navigator');
  if (nav && typeof nav === 'object') {
    const ua = (nav as { userAgent?: unknown }).userAgent;
    if (typeof ua === 'string' && ua.includes('Cloudflare')) return true;
  }
  return false;
}

/** True when Node.js APIs are present (`process.versions.node`). */
function hasNodeProcess(): boolean {
  const proc = getGlobal('process');
  if (!proc || typeof proc !== 'object') return false;
  const versions = (proc as { versions?: unknown }).versions;
  if (!versions || typeof versions !== 'object') return false;
  return typeof (versions as { node?: unknown }).node === 'string';
}

/** True when `AsyncLocalStorage` is importable-ish (Node-like server runtime). */
function hasAsyncLocalStorage(): boolean {
  // Best-effort: available on Node and Node-compatible servers. We avoid a
  // dynamic import here (must stay synchronous & non-throwing); presence of a
  // Node process is a sufficient signal for our purposes.
  return hasNodeProcess();
}

let memo: DetectedEnvironment | undefined;

/** True when running inside a Next.js server runtime (sets NEXT_RUNTIME). */
function isNextServer(): boolean {
  const proc = getGlobal('process') as { env?: Record<string, string | undefined> } | undefined;
  return typeof proc?.env?.['NEXT_RUNTIME'] === 'string';
}

/**
 * Detects the current JavaScript runtime and its platform capabilities.
 *
 * Detection order: edge → browser (DOM present) → node → nextjs-server.
 * Never throws; the result is memoized at the module level.
 */
export function detectEnvironment(): DetectedEnvironment {
  if (memo !== undefined) return memo;

  const hasWindow = getGlobal('window') !== undefined;
  const hasDocument = getGlobal('document') !== undefined;
  const hasDom = hasWindow && hasDocument;
  const hasFetch = typeof getGlobal('fetch') === 'function';
  const edge = isEdgeRuntime();
  const node = hasNodeProcess();

  let environment: Environment;
  if (edge) {
    environment = 'edge';
  } else if (hasDom) {
    environment = 'browser';
  } else if (node) {
    // Distinguish a Next.js server runtime from plain Node via NEXT_RUNTIME,
    // which Next sets to 'nodejs' | 'edge'. Absent it, this is plain Node.
    environment = isNextServer() ? 'nextjs-server' : 'node';
  } else {
    environment = 'node';
  }

  const capabilities: PlatformCapabilities = {
    // Axios relies on Node http/XHR; unavailable on edge runtimes.
    supportsAxios: !edge,
    supportsAsyncLocalStorage: !edge && hasAsyncLocalStorage(),
    hasDom,
    hasFetch,
    hasVisibilityApi: hasDocument,
  };

  memo = { environment, capabilities };
  return memo;
}
