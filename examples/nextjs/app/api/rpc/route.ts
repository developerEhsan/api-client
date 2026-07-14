import { rpcHandler } from '@/lib/api/api.config';
/**
 * Generic HTTP RPC endpoint (framework-agnostic transport). This is the second
 * way to reach the bridge — equivalent to the Server Action, but usable from
 * TanStack Start or any fetch client via `httpTransport({ endpoint: '/api/rpc' })`.
 *
 * The handler enforces CSRF (same-origin) and a body-size cap itself, since a
 * raw route has no framework-provided protection.
 */
import { createRpcRouteHandler } from '@developerEhsan/api-client/server';

const handle = createRpcRouteHandler(rpcHandler);

export function POST(request: Request): Promise<Response> {
  return handle(request);
}
