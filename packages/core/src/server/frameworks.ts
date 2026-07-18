/**
 * First-party RPC route adapters for TanStack Start and Remix (roadmap E5).
 * Both frameworks speak the WHATWG `Request`/`Response` contract that
 * {@link createRpcRouteHandler} already implements, so these are thin, typed
 * seams that adapt each framework's handler-argument shape — the same
 * deny-by-default trust boundary and CSRF/body-size guards apply unchanged.
 */
import type { RpcHandler } from './createRpcHandler';
import { type RpcRouteOptions, createRpcRouteHandler } from './routeHandler';

/**
 * A TanStack Start server-route handler. Start passes a context object carrying
 * the web `request`; this returns a `POST` handler you can register.
 *
 * @example
 * // app/routes/api/rpc.ts
 * import { createStartRpcRoute } from '@developerehsan/api-client/server'
 * import { handler } from '~/lib/api.config'
 * export const POST = createStartRpcRoute(handler)
 */
export function createStartRpcRoute(
  handler: RpcHandler,
  options?: RpcRouteOptions,
): (ctx: { request: Request }) => Promise<Response> {
  const route = createRpcRouteHandler(handler, options);
  return ({ request }) => route(request);
}

/**
 * A Remix (or React Router) `action` for an RPC resource route. Remix invokes
 * `action({ request })`; this adapts it to the route handler.
 *
 * @example
 * // app/routes/api.rpc.ts
 * import { createRemixRpcAction } from '@developerehsan/api-client/server'
 * import { handler } from '~/lib/api.config'
 * export const action = createRemixRpcAction(handler)
 */
export function createRemixRpcAction(
  handler: RpcHandler,
  options?: RpcRouteOptions,
): (args: { request: Request }) => Promise<Response> {
  const route = createRpcRouteHandler(handler, options);
  return ({ request }) => route(request);
}
