/**
 * Transports for the browser RPC client. Two flavours cover the SSR frameworks:
 *
 * - `serverActionTransport` wraps a framework server function (Next.js Server
 *   Action, TanStack Start server fn). CSRF/same-origin is enforced by the
 *   framework.
 * - `httpTransport` POSTs to a generic same-origin RPC route (pairs with
 *   `createRpcRouteHandler` on the server). Framework-agnostic.
 */

import {
  type RpcBatchRequest,
  type RpcCall,
  type RpcResponse,
  isRpcResponse,
} from '../rpc/protocol';
import type { Transport } from './types';

/** The server-action function shape produced by `createNextRpcAction`. */
export type ServerAction = (
  payload: RpcCall | RpcBatchRequest,
) => Promise<RpcResponse | RpcResponse[]>;

/**
 * Wrap a bound server action as a transport. The action already returns the
 * uniform envelope, so this is a thin, named seam. Also supports batching: a
 * `{ __rpcBatch }` payload yields a positional `RpcResponse[]`.
 *
 * @example
 * import { createRpcClient, serverActionTransport } from '@developerehsan/api-client/browser'
 * import type { Api } from './server/api.config' // type-only — erased
 * import { rpc } from './server/rpc' // exported from a "use server" module
 *
 * const api = createRpcClient<Api>(serverActionTransport(rpc))
 * await api.pet.findPetsByStatus({ status: 'available' })
 */
export function serverActionTransport(action: ServerAction): Transport {
  const transport: Transport = (call: RpcCall): Promise<RpcResponse> =>
    action(call) as Promise<RpcResponse>;
  transport.batch = (calls: RpcCall[]): Promise<RpcResponse[]> =>
    action({ __rpcBatch: calls }) as Promise<RpcResponse[]>;
  return transport;
}

/** Options for {@link httpTransport}. */
export interface HttpTransportOptions {
  /**
   * The RPC route to POST to. Use a **same-origin** path (e.g. `"/api/rpc"`) so
   * the request carries the app's cookies and passes the server route's
   * same-origin CSRF check. No default — required.
   */
  endpoint: string;
  /**
   * Fetch implementation to use. Override to inject credentials, a base URL, or
   * a test double.
   * @default globalThis.fetch
   */
  fetch?: typeof fetch;
  /**
   * Extra headers merged into every request (e.g. a CSRF/double-submit token,
   * `x-tenant-id`). `content-type: application/json` is always set and should
   * not be overridden.
   * @default undefined (no extra headers)
   */
  headers?: Record<string, string>;
}

/**
 * POST each call to a same-origin RPC route as JSON. The `Content-Type:
 * application/json` header is deliberate: it forces a CORS preflight for
 * cross-origin callers, which — together with the server route's Origin check —
 * closes the simple-request CSRF vector.
 *
 * @example
 * import { createRpcClient, httpTransport } from '@developerehsan/api-client/browser'
 * import type { Api } from './server/api.config' // type-only — erased
 *
 * const api = createRpcClient<Api>(
 *   httpTransport({ endpoint: '/api/rpc', headers: { 'x-csrf-token': token } }),
 * )
 * await api.pet.getPetById({ petId: 1 })
 */
export function httpTransport(options: HttpTransportOptions): Transport {
  const { endpoint, headers } = options;
  const doFetch = options.fetch ?? globalThis.fetch;

  const transportError = (status: number): RpcResponse => ({
    ok: false,
    error: {
      __rpcError: true,
      name: 'ApiError',
      status,
      code: 'rpc_transport_error',
      message: 'The request could not be completed.',
    },
  });

  const post = async (payload: unknown): Promise<{ status: number; body: unknown }> => {
    if (typeof doFetch !== 'function') {
      throw new Error('httpTransport: no fetch implementation available.');
    }
    const res = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    return { status: res.status, body };
  };

  const transport: Transport = async (call: RpcCall): Promise<RpcResponse> => {
    const { status, body } = await post(call);
    // Transport-level failure (CSRF reject, 4xx/5xx without an envelope): surface
    // a generic error envelope rather than leaking the raw response.
    return isRpcResponse(body) ? body : transportError(status);
  };

  transport.batch = async (calls: RpcCall[]): Promise<RpcResponse[]> => {
    const { status, body } = await post({ __rpcBatch: calls });
    if (Array.isArray(body)) return body as RpcResponse[];
    // A single-envelope reply to a batch = whole-batch failure; propagate to all.
    const err = isRpcResponse(body) ? body : transportError(status);
    return calls.map(() => err);
  };

  return transport;
}
