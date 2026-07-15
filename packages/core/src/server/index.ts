/**
 * `@developerehsan/api-client/server` — the server-side half of the SSR RPC
 * bridge. Import this in a server-only module (Server Action, route handler).
 * It runs the real secret-holding client behind an allowlist-guarded boundary.
 */

export { createRpcHandler } from './createRpcHandler';
export type {
  RpcHandler,
  RpcHandlerOptions,
  RpcRequestContext,
  ExposeMap,
} from './createRpcHandler';
export { createNextRpcAction, type NextRpcAction } from './nextAction';
export { createRpcRouteHandler, type RpcRouteOptions } from './routeHandler';
export { RpcSecurityError } from './security';
export type { RpcCall, RpcResponse, RpcErrorShape } from '../rpc/protocol';
