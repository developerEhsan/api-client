import { rateLimitDemoHandler } from '@/lib/api/api.config';
/**
 * Route for the dedicated rate-limiting demo bridge (3 calls / 10s).
 * Docs: https://github.com/developerEhsan/api-client/blob/master/docs/rpc-rate-limiting.md
 */
import { createRpcRouteHandler } from '@developerehsan/api-client/server';

const handle = createRpcRouteHandler(rateLimitDemoHandler);

export function POST(request: Request): Promise<Response> {
  return handle(request);
}
