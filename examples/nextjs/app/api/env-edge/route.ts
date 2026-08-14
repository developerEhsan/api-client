/**
 * Edge runtime variant of the environment-switching demo.
 * Docs: https://github.com/developerEhsan/api-client/blob/master/docs/environments.md
 *
 * `runtime = 'edge'` runs this route on the Edge runtime, where
 * `detectEnvironment()` reports `capabilities.supportsAxios: false` — Axios
 * depends on Node APIs unavailable there. Requesting `http.adapter: 'axios'`
 * still works, but is silently downgraded to 'fetch' with a `console.warn`
 * (see `packages/core/src/environment/edgeSafe.ts`'s `resolveAdapterName`).
 */
import { createClient, detectEnvironment } from '@developerehsan/api-client';

export const runtime = 'edge';

export async function GET(): Promise<Response> {
  const env = detectEnvironment();

  let warned = false;
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warned = true;
    originalWarn(...args);
  };
  try {
    // Requesting 'axios' explicitly — on edge this gets downgraded to 'fetch'.
    createClient({
      baseURL: 'https://dummyjson.com',
      openapi: { mode: 'runtime' },
      http: { adapter: 'axios' },
    });
  } finally {
    console.warn = originalWarn;
  }

  return Response.json({
    route: '/api/env-edge',
    environment: env.environment,
    supportsAxios: env.capabilities.supportsAxios,
    requestedAdapter: 'axios',
    effectiveAdapter: warned ? 'fetch (downgraded)' : 'axios',
  });
}
