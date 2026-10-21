/**
 * Framework-agnostic HTTP RPC route. `createRpcRouteHandler` returns a
 * `(Request) => Response` usable as a Next.js App Router `route.ts` handler, a
 * TanStack Start API route, or any fetch-based server. A raw endpoint has no
 * built-in CSRF protection, so this half enforces it (S7): POST + JSON only,
 * plus an Origin / Sec-Fetch-Site check. It also caps body size (S6).
 */

import {
  RPC_MULTIPART_ENVELOPE,
  type RpcResponse,
  isRpcBatchRequest,
  isRpcBinaryOk,
  isRpcFileMarker,
} from '../rpc/protocol';
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
  /**
   * Accept `multipart/form-data` bodies so calls can carry `File`/`Blob`
   * arguments (#38). Off by default: it widens the accepted content types, and
   * a multipart body is not covered by the JSON-content-type half of the CSRF
   * defence, so it leans entirely on the Origin check.
   *
   * Leave `csrf` on when enabling this, and size it with `maxUploadBytes`.
   *
   * @default false
   * @example `{ multipart: true, maxUploadBytes: 10 * 1024 * 1024 }`
   */
  multipart?: boolean;
  /**
   * Max multipart body size in bytes. Separate from `maxBodyBytes` because an
   * upload is legitimately far larger than a JSON envelope — raising the JSON
   * cap to fit a file would widen the DoS surface on every other call.
   * @default 10485760 (10 MB)
   */
  maxUploadBytes?: number;
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

/**
 * Read at most `limit` bytes off the request body, aborting as soon as the cap
 * is passed. `Content-Length` is a client-supplied claim — it can be wrong, or
 * absent entirely under chunked transfer-encoding — so the limit has to be
 * enforced against the bytes themselves, not the header.
 *
 * Returns `null` when the body exceeds the cap.
 *
 * Over the cap we stop reading and release the lock WITHOUT calling
 * `reader.cancel()`. Cancelling closes the stream while the runtime may still
 * be enqueueing already-received chunks into it, which surfaces as
 * `ERR_INVALID_STATE: ReadableStream is already closed` thrown inside undici —
 * an unhandled rejection we cannot catch from here, and one that can take down
 * a server process. Dropping the reader is enough: the caller responds 413
 * immediately and the runtime tears the request down.
 */
async function readLimited(req: Request, limit: number): Promise<ArrayBuffer | null> {
  const body = req.body;
  if (!body) return new ArrayBuffer(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) return null;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer as ArrayBuffer;
}

/**
 * Rebuild the call envelope from a multipart body: the JSON lives in the
 * `__rpc` part with `{ __rpcFile }` placeholders, each naming the part that
 * carries its bytes (#38).
 *
 * Only placeholders are substituted, and only from parts actually present, so
 * a crafted body can at worst inject a `File` the handler's own input
 * validation then sees.
 */
function reviveMultipart(form: FormData): unknown {
  const raw = form.get(RPC_MULTIPART_ENVELOPE);
  if (typeof raw !== 'string') throw new SyntaxError('missing envelope');
  const envelope: unknown = JSON.parse(raw);

  const substitute = (value: unknown): unknown => {
    if (isRpcFileMarker(value)) {
      const file = form.get(value.__rpcFile);
      return file === null ? undefined : file;
    }
    if (Array.isArray(value)) return value.map(substitute);
    if (typeof value === 'object' && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        // defineProperty, not `out[k] = …`: a plain assignment with the key
        // `__proto__` invokes the prototype setter, so the key vanishes from
        // `Object.keys` and slips past the handler's FORBIDDEN_KEYS check.
        // This keeps it an own, enumerable property so that guard still sees it.
        Object.defineProperty(out, k, {
          value: substitute(v),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    return value;
  };

  return substitute(envelope);
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
  const multipart = options.multipart ?? false;
  const maxUploadBytes = options.maxUploadBytes ?? 10 * 1024 * 1024;

  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return jsonResponse(genericError(405, 'method_not_allowed'), 405);

    const contentType = req.headers.get('content-type') ?? '';
    const isMultipart = multipart && contentType.includes('multipart/form-data');
    if (!isMultipart && !contentType.includes('application/json')) {
      return jsonResponse(genericError(415, 'unsupported_media_type'), 415);
    }

    // Ordered before any body read so a rejected origin never costs us the
    // parse of a large upload.
    if (csrf && !originAllowed(req, options.allowedOrigins)) {
      return jsonResponse(genericError(403, 'forbidden'), 403);
    }

    const limit = isMultipart ? maxUploadBytes : maxBodyBytes;
    const contentLength = req.headers.get('content-length');
    // Cheap pre-check on the declared length; `readLimited` below is what
    // actually enforces the cap, since the header can lie or be absent.
    if (contentLength && Number(contentLength) > limit) {
      return jsonResponse(genericError(413, 'payload_too_large'), 413);
    }

    const raw = await readLimited(req, limit);
    if (raw === null) return jsonResponse(genericError(413, 'payload_too_large'), 413);

    let payload: unknown;
    if (isMultipart) {
      try {
        // Re-wrap the already-bounded bytes so the runtime's own multipart
        // parser does the parsing, with the original Content-Type (boundary).
        const form = await new Response(raw, {
          headers: { 'content-type': contentType },
        }).formData();
        payload = reviveMultipart(form);
      } catch {
        return jsonResponse(genericError(400, 'bad_multipart'), 400);
      }
    } else {
      try {
        payload = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        return jsonResponse(genericError(400, 'bad_json'), 400);
      }
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
    const result = await handler.handle(payload, ctx);
    // A method the server declared `binary` streams back as-is, carrying its
    // own Content-Type/Content-Disposition instead of a JSON envelope (#37).
    if (isRpcBinaryOk(result)) {
      return new Response(result.data as BodyInit, {
        status: 200,
        headers: {
          'content-type': result.contentType || 'application/octet-stream',
          ...(result.contentDisposition
            ? { 'content-disposition': result.contentDisposition }
            : {}),
        },
      });
    }
    return jsonResponse(result, 200);
  };
}
