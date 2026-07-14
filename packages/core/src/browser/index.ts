/**
 * `@developerEhsan/api-client/browser` — the client-side half of the SSR RPC
 * bridge. Import this from client components. It ships no backend URL, no paths,
 * and no OpenAPI data.
 */

export { createRpcClient } from './createRpcClient';
export {
  serverActionTransport,
  httpTransport,
  type ServerAction,
  type HttpTransportOptions,
} from './transports';
export type { RpcClient, Transport, RpcPerCall } from './types';
export { ApiError } from '../errors/ApiError';
export {
  isRpcErrorShape,
  isRpcResponse,
  type RpcCall,
  type RpcResponse,
  type RpcErrorShape,
} from '../rpc/protocol';
