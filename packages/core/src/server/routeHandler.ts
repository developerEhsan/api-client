/**
 * Framework-agnostic HTTP RPC route. `createRpcRouteHandler` returns a
 * `(Request) => Response` usable as a Next.js App Router `route.ts` handler, a
 * TanStack Start API route, or any fetch-based server. A raw endpoint has no
 * built-in CSRF protection, so this half enforces it (S7): POST + JSON only,
 * plus an Origin / Sec-Fetch-Site check. It also caps body size (S6).
 */

import { type RpcResponse, isRpcBatchRequest } from '../rpc/protocol';
import type { RpcHandler, RpcRequestContext } from './createRpcHandler';

/** Options for {@link createRpcRouteHandler}. */
export interface RpcRouteOptions {
  /** Enforce CSRF checks. Default `true`. */
  csrf?: boolean;
  /**
   * Allowed cross-origin origins. A list, or a predicate. When omitted, only
   * same-origin requests (Origin host === Host, or Sec-Fetch-Site same-origin)
   * are accepted.
   */
  allowedOrigins?: readonly string[] | ((origin: string) => boolean);
  /** Max request body size in bytes. Default 128 KB. */
  maxBodyBytes?: number;
}

/** Read one cookie value from a raw `Cookie` header, or `undefined`. */
function parseCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

function jsonResponse(body: RpcResponse | RpcResponse[], status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Uniform generic error envelope (S8/S9). */
function genericError(status: number, code: string): RpcResponse {
  return {
    ok: false,
    error: {
      __rpcError: true,
      name: 'ApiError',
      status,
      code,
      message: 'The request could not be completed.',
    },
  };
}

/** Same-origin / allowlist check (S7). */
function originAllowed(req: Request, allowed: RpcRouteOptions['allowedOrigins']): boolean {
  const origin = req.headers.get('origin');
  if (allowed !== undefined) {
    if (!origin) return false;
    return typeof allowed === 'function' ? allowed(origin) : allowed.includes(origin);
  }
  const site = req.headers.get('sec-fetch-site');
  if (site === 'same-origin' || site === 'none') return true;
  // No Origin header (non-browser client / same-origin GET) and no cross-site
  // signal: no CSRF risk since JSON content-type already blocks HTML forms.
  if (!origin) return site === null;
  const host = req.headers.get('host');
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Build a fetch-style RPC route over `handler`.
 *
 * @example
 * // app/api/rpc/route.ts (Next.js App Router)
 * import { createRpcRouteHandler } from '@developerehsan/api-client/server'
 * import { handler } from '../../api.config'
 *
 * const route = createRpcRouteHandler(handler, {
 *   allowedOrigins: ['https://app.example.com'], // omit for same-origin only
 *   maxBodyBytes: 64 * 1024,
 * })
 * export const POST = route
 *
 * @example
 * // browser side pairs with httpTransport
 * import { createRpcClient, httpTransport } from '@developerehsan/api-client/browser'
 * import type { Api } from './api.config'
 *
 * const api = createRpcClient<Api>(httpTransport({ endpoint: '/api/rpc' }))
 * await api.pet.getPetById({ petId: 1 })
 */
export function createRpcRouteHandler(
  handler: RpcHandler,
  options: RpcRouteOptions = {},
): (req: Request) => Promise<Response> {
  const csrf = options.csrf ?? true;
  const maxBodyBytes = options.maxBodyBytes ?? 128 * 1024;

  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return jsonResponse(genericError(405, 'method_not_allowed'), 405);

    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return jsonResponse(genericError(415, 'unsupported_media_type'), 415);
    }

    if (csrf && !originAllowed(req, options.allowedOrigins)) {
      return jsonResponse(genericError(403, 'forbidden'), 403);
    }

    const contentLength = req.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxBodyBytes) {
      return jsonResponse(genericError(413, 'payload_too_large'), 413);
    }

    const text = await req.text();
    if (text.length > maxBodyBytes) {
      return jsonResponse(genericError(413, 'payload_too_large'), 413);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return jsonResponse(genericError(400, 'bad_json'), 400);
    }

    const ctx: RpcRequestContext = {
      origin: req.headers.get('origin') ?? undefined,
      getHeader: (name: string) => req.headers.get(name) ?? undefined,
      getCookie: (name: string) => parseCookie(req.headers.get('cookie'), name),
    };
    // A batch envelope returns a positional RpcResponse[]; a single call returns
    // one RpcResponse. The whole-body size cap above still bounds either shape.
    if (isRpcBatchRequest(payload)) {
      return jsonResponse(await handler.handleBatch(payload, ctx), 200);
    }
    return jsonResponse(await handler.handle(payload, ctx), 200);
  };
}
