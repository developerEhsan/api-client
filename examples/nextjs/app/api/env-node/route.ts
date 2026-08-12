/**
 * Node runtime variant of the environment-switching demo.
 * Docs: https://github.com/developerEhsan/api-client/blob/master/docs/environments.md
 *
 * `runtime = 'nodejs'` is the Next.js default, but is stated explicitly here
 * to contrast with `../env-edge/route.ts`'s `runtime = 'edge'`.
 */
import { createClient, detectEnvironment } from '@developerehsan/api-client';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const env = detectEnvironment();

  let warned = false;
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warned = true;
    originalWarn(...args);
  };
  try {
    // Requesting 'axios' explicitly — on Node this is honored as-is.
    createClient({ baseURL: 'https://dummyjson.com', openapi: { mode: 'runtime' }, http: { adapter: 'axios' } });
  } finally {
    console.warn = originalWarn;
  }

  return Response.json({
    route: '/api/env-node',
    environment: env.environment,
    supportsAxios: env.capabilities.supportsAxios,
    requestedAdapter: 'axios',
    // No downgrade warning fired => the requested adapter stayed in effect.
    effectiveAdapter: warned ? 'fetch (downgraded)' : 'axios',
  });
}
