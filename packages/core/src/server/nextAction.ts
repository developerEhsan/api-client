/**
 * Next.js Server Action glue. Wrap an {@link RpcHandler} into a function you can
 * export from a `"use server"` module. Same-origin/CSRF protection is provided
 * by Next.js for Server Actions, so this half only threads request context
 * (headers/cookies) through for `authorize`/`onRequest` hooks. The real client's
 * own auth/tenant resolvers read `next/headers` during the call, so per-request
 * isolation (S10) is preserved by Next's request scoping.
 */

import { readServerCookie, readServerHeader } from '../environment/serverContext';
import { type RpcResponse, isRpcBatchRequest } from '../rpc/protocol';
import type { RpcHandler, RpcRequestContext } from './createRpcHandler';

/**
 * A bound server action. Returns a single {@link RpcResponse} for a normal
 * call, or a positional `RpcResponse[]` when handed a batch envelope.
 */
export type NextRpcAction = (payload: unknown) => Promise<RpcResponse | RpcResponse[]>;

/**
 * Wrap a handler as a Next.js Server Action.
 *
 * @example
 * // app/rpc.ts
 * 'use server'
 * import { createNextRpcAction } from '@developerehsan/api-client/server'
 * import { handler } from './api.config'
 *
 * export const rpc = createNextRpcAction(handler)
 *
 * @example
 * // app/client.ts (browser) — type-only import keeps the secrets server-side
 * 'use client'
 * import { createRpcClient, serverActionTransport } from '@developerehsan/api-client/browser'
 * import type { Api } from './api.config'
 * import { rpc } from './rpc'
 *
 * export const api = createRpcClient<Api>(serverActionTransport(rpc))
 * await api.pet.findPetsByStatus({ status: 'available' }) // browser sends only { module, method, args }
 */
export function createNextRpcAction(handler: RpcHandler): NextRpcAction {
  return async function rpcAction(payload: unknown): Promise<RpcResponse | RpcResponse[]> {
    const ctx: RpcRequestContext = {
      origin: await readServerHeader('origin'),
      getHeader: (name: string) => readServerHeader(name),
      getCookie: (name: string) => readServerCookie(name),
    };
    if (isRpcBatchRequest(payload)) return handler.handleBatch(payload, ctx);
    return handler.handle(payload, ctx);
  };
}
