/**
 * The server half of the SSR RPC bridge and the single trust boundary. Given
 * the real (secret-holding) client, `createRpcHandler` returns `handle(payload)`
 * which validates every field the browser sends before dispatching. Treat the
 * payload as hostile: allowlist, authorize, sanitize, then run — see the threat
 * table (S1–S13) in the design.
 *
 * `handle` never rejects for application errors; it resolves to a uniform
 * `RpcResponse` envelope so Server Actions and HTTP routes deliver structured,
 * rehydratable errors to the browser.
 */

import {
  type RpcCall,
  type RpcHandledResponse,
  type RpcResponse,
  isRpcBatchRequest,
  isRpcBinaryOk,
} from '../rpc/protocol';
import { assertServerOnly } from '../utilities/serverOnly';
import {
  RpcSecurityError,
  assertPrimitivePathParams,
  assertSafeInput,
  isSafeName,
  notAvailable,
  sanitizeError,
  sanitizePerCall,
} from './security';

/** Per-request context passed to `authorize`/`onRequest`/`transformResult`. */
export interface RpcRequestContext {
  /** Request origin, when known (populated by the HTTP route). */
  origin?: string;
  /** Read a request header (async in Next Server Actions). */
  getHeader?: (name: string) => string | undefined | Promise<string | undefined>;
  /** Read a request cookie. */
  getCookie?: (name: string) => string | undefined | Promise<string | undefined>;
  /** Arbitrary caller-attached context (session, user, …). */
  [key: string]: unknown;
}

/**
 * The concrete own keys of `T`, excluding any `string`/`number` index
 * signature. The typed client carries an index signature (so `keyof Api`
 * collapses to `string`); stripping it recovers the real module names — and,
 * per module, the real method names — for precise autocomplete.
 */
type KnownKeys<T> = keyof {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: unknown;
};

/** Client members that are utilities, not callable RPC modules. */
type ReservedClientKey = 'cache' | 'config' | 'setEnvironment' | 'getSchema' | 'on' | 'off';

/** The callable module names on `Api` (index signature + reserved utilities removed). */
export type ModuleName<Api> = Exclude<KnownKeys<Api>, ReservedClientKey>;

/**
 * Deny-by-default allowlist (S1). Per module either:
 * - an **array of method names** — only those methods are callable, or
 * - `true` — every method on that module is callable.
 *
 * Fully typed against `Api`: module names **and** each module's method names
 * autocomplete, and any typo (wrong module or wrong method) is a compile error.
 * Custom methods added in `config.modules` (e.g. `pet.removePet`) and brand-new
 * modules appear here too, because the names come from the real client surface.
 *
 * @example
 * expose: {
 *   pet: ["getPetById", "findPetsByStatus"], // ← method names autocomplete
 *   store: true,                              // ← every store method
 * }
 */
export type ExposeMap<Api> = {
  [M in ModuleName<Api>]?: readonly (keyof Api[M] & string)[] | true;
};

/** Options for {@link createRpcHandler}. */
export interface RpcHandlerOptions<Api> {
  /** The allowlist of callable `module.method` pairs (S1). Required. */
  expose: ExposeMap<Api>;
  /**
   * Methods whose response is an opaque file/stream rather than JSON — CSV and
   * PDF exports, attachment downloads (#37). Same shape as `expose`, and a
   * method must be in BOTH to be callable.
   *
   * Declared here and nowhere else on purpose: a client-supplied
   * `responseType` is stripped by `sanitizePerCall` (S4), so the browser can
   * never turn a JSON method into a byte stream. The handler forces
   * `responseType: 'blob'` for these and the route streams the result back
   * with its own `Content-Type`/`Content-Disposition` instead of wrapping it
   * in the JSON envelope.
   *
   * @default undefined (every exposed method is treated as JSON)
   * @example `binary: { exports: ['flagsCsv', 'logsCsv'] }`
   */
  binary?: ExposeMap<Api>;
  /**
   * Names the file a binary response downloads as, by setting
   * `Content-Disposition`. Return `undefined` to leave it unset (the browser
   * then renders inline where it can).
   *
   * @default undefined (no Content-Disposition header)
   * @example `binaryFilename: (call) => `${call.method}-${Date.now()}.csv``
   */
  binaryFilename?: (call: RpcCall<Api>, ctx: RpcRequestContext) => string | undefined;
  /**
   * Per-call permission check (S3), run AFTER the allowlist but BEFORE dispatch.
   * Return `false` (or reject) to deny — the caller then gets the same uniform
   * "not available" error as an unknown method, so a probing client cannot tell
   * "exists but forbidden" from "does not exist" (S9). Use for row-level auth,
   * role checks, or guarding mutations. `ctx` carries the request headers/cookies.
   * @default undefined (every exposed method is allowed)
   */
  authorize?: (ctx: RpcRequestContext, call: RpcCall<Api>) => boolean | Promise<boolean>;
  /**
   * Middleware run just before dispatch (S11). Throw to reject the call (the
   * error is sanitized like any other). The integration point for rate limiting,
   * quotas, and audit logging.
   * @default undefined (no middleware)
   */
  onRequest?: (ctx: RpcRequestContext, call: RpcCall<Api>) => void | Promise<void>;
  /**
   * Observe the FULL, unsanitized error server-side (S8) — for logging/telemetry.
   * The browser still receives only the sanitized shape. `call` is `null` if the
   * payload was malformed before a call could be parsed. Never throws to the client.
   * @default undefined (no logging)
   */
  onError?: (error: unknown, call: RpcCall<Api> | null) => void;
  /**
   * Project or redact the successful result before it is serialized to the wire
   * (S12) — enforce least-privilege by stripping fields the client shouldn't see.
   * @default undefined (result returned as-is)
   */
  transformResult?: (
    result: unknown,
    call: RpcCall<Api>,
    ctx: RpcRequestContext,
  ) => unknown | Promise<unknown>;
  /**
   * Max nesting depth allowed in client input before it is rejected (S6, DoS
   * guard). Deeper input → uniform error, payload not echoed.
   * @default 8
   */
  maxInputDepth?: number;
  /**
   * Max keys per object / elements per array in client input (S6, DoS guard).
   * @default 1000
   */
  maxInputKeys?: number;
  /**
   * Upper bound (ms) applied to a client-supplied per-call `timeout` (S4) so a
   * client cannot pin a server request open indefinitely.
   * @default 30000
   */
  maxTimeout?: number;
  /**
   * When `true`, include structured error `details` (the backend's own error
   * body) on the wire; stacks/URLs/headers are never included regardless (S8).
   * Leave unset in production.
   * @default process.env.NODE_ENV !== 'production'
   */
  dev?: boolean;
  /**
   * Max sub-calls allowed in one batch (S14 amplification guard). A batch over
   * this size is rejected WHOLE, before any sub-call is dispatched.
   * @default 10
   */
  maxBatchSize?: number;
  /**
   * Throws immediately if this handler is constructed in a browser context
   * (spec 06) — this is the real trust boundary (see SECURITY.md), so
   * leaving this on unless you have a specific, documented reason not to
   * (e.g. a jsdom-based unit test importing server code) is strongly
   * recommended. Defaults to enforced, unlike most config in this library —
   * there is no legitimate reason to construct an RPC handler in a browser.
   * @default true
   */
  enforceServerOnly?: boolean;
}

/** The dispatcher returned by {@link createRpcHandler}. */
export interface RpcHandler {
  /**
   * Validate and dispatch one browser payload. Never rejects for application
   * errors — always resolves to a uniform {@link RpcResponse} envelope.
   *
   * @example
   * const res = await handler.handle(
   *   { module: 'pet', method: 'getPetById', args: [{ petId: 1 }] },
   *   { origin: 'https://app.example.com' },
   * )
   * if (res.ok) console.log(res.data) // → Pet
   */
  handle(payload: unknown, ctx?: RpcRequestContext): Promise<RpcHandledResponse>;
  /**
   * Validate and dispatch a batch envelope (`{ __rpcBatch: RpcCall[] }`). Each
   * sub-call runs through the SAME per-call trust boundary as {@link handle}
   * (allowlist → input caps → authorize → onRequest → dispatch → transform),
   * and one failing sub-call never affects its siblings. Returns responses
   * positionally. Envelope-level violations (empty, over `maxBatchSize`, or a
   * nested batch) reject the WHOLE batch as a single-element error array before
   * any dispatch (S14/S16).
   */
  handleBatch(payload: unknown, ctx?: RpcRequestContext): Promise<RpcResponse[]>;
}

function defaultDev(): boolean {
  try {
    return (
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
        ?.NODE_ENV !== 'production'
    );
  } catch {
    return false;
  }
}

/** Whether `module.method` is present in the allowlist (S1). */
function isExposed<Api>(
  expose: ExposeMap<Api> | undefined,
  moduleName: string,
  methodName: string,
): boolean {
  if (!expose) return false;
  const entry = (expose as Record<string, readonly string[] | true | undefined>)[moduleName];
  if (entry === undefined) return false;
  if (entry === true) return true;
  return entry.includes(methodName);
}

/** True for a payload the route can stream back as-is. */
function isBinaryPayload(value: unknown): boolean {
  return (
    (typeof Blob !== 'undefined' && value instanceof Blob) ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream)
  );
}

/**
 * Strip anything that could break out of the quoted `filename="..."` of a
 * `Content-Disposition` header — a header-injection guard, since the name may
 * be derived from user-controlled data.
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-+ ]/g, '_').slice(0, 120);
}

/** Validate the envelope shape and names; unsafe names collapse to not-available (S1, S2, S9). */
function parsePayload<Api>(payload: unknown): RpcCall<Api> {
  if (typeof payload !== 'object' || payload === null) {
    throw new RpcSecurityError('bad_payload', 400);
  }
  const { module: moduleName, method: methodName, args } = payload as RpcCall<Api>;
  if (!isSafeName(moduleName) || !isSafeName(methodName)) throw notAvailable();
  // Only `[input, perCall]` are meaningful; drop anything extra.
  const safeArgs = Array.isArray(args) ? args.slice(0, 2) : [];
  return { module: moduleName, method: methodName, args: safeArgs };
}

/**
 * Build an RPC handler over the real `api`. `expose` is required and deny-by-default.
 *
 * @example
 * // server/api.config.ts (holds the secrets — never imported by the browser)
 * import { createClient } from './generated'
 * import { createRpcHandler } from '@developerehsan/api-client/server'
 *
 * const server = createClient({ baseURL: 'https://petstore3.swagger.io/api/v3' })
 * export type Api = typeof server
 *
 * export const handler = createRpcHandler(server, {
 *   // deny-by-default; module + method names autocomplete against Api
 *   expose: { pet: ['getPetById', 'findPetsByStatus'], store: true },
 *   authorize: async (ctx, call) => {
 *     if (call.module === 'store') return Boolean(await ctx.getCookie?.('session'))
 *     return true
 *   },
 * })
 */
export function createRpcHandler<Api extends object>(
  api: Api,
  options: RpcHandlerOptions<Api>,
): RpcHandler {
  const maxInputDepth = options.maxInputDepth ?? 8;
  const maxInputKeys = options.maxInputKeys ?? 1000;
  const maxTimeout = options.maxTimeout ?? 30_000;
  const maxBatchSize = options.maxBatchSize ?? 10;
  const dev = options.dev ?? defaultDev();

  if (options.enforceServerOnly ?? true) assertServerOnly('createRpcHandler');

  /** Sanitize + log one error into a failure envelope (shared by single/batch). */
  const fail = (error: unknown, call: RpcCall<Api> | null): RpcResponse => {
    // S8: log the full error server-side; return only the sanitized shape.
    if (options.onError) {
      try {
        options.onError(error, call);
      } catch {
        /* never let a logging hook break the response */
      }
    }
    return { ok: false, error: sanitizeError(error, dev) };
  };

  /**
   * The single per-call trust boundary. Runs for every call — standalone AND
   * each batch entry — so a batch can never skip a check (S13/S15).
   */
  const dispatchOne = async (
    payload: unknown,
    ctx: RpcRequestContext,
  ): Promise<RpcHandledResponse> => {
    let call: RpcCall<Api> | null = null;
    try {
      call = parsePayload(payload);

      // S1: deny-by-default allowlist.
      if (!isExposed(options.expose, call.module, call.method)) throw notAvailable();

      // S2/S5/S6: validate client input before it reaches URL construction.
      const input = call.args[0];
      assertSafeInput(input, maxInputDepth, maxInputKeys);
      assertPrimitivePathParams(input);

      // S3: authorization (separate from existence) — runs PER call, incl. per
      // batch entry, so an allowed sibling never authorizes a denied one (S15).
      if (options.authorize && !(await options.authorize(ctx, call))) throw notAvailable();

      // S11: pre-dispatch middleware (rate-limit / audit) — may throw to reject.
      if (options.onRequest) await options.onRequest(ctx, call);

      // S1 (again): only now index the client, with a validated name.
      const mod = (api as Record<string, unknown>)[call.module];
      const fn =
        typeof mod === 'object' && mod !== null
          ? (mod as Record<string, unknown>)[call.method]
          : undefined;
      if (typeof fn !== 'function') throw notAvailable();

      // S4: drop client-controlled perCall except a clamped timeout.
      const perCall = sanitizePerCall(call.args[1], maxTimeout);

      // `responseType` is forced from the SERVER-side `binary` allowlist, never
      // from the wire — sanitizePerCall already dropped any client value (S4).
      const wantsBinary = isExposed(options.binary, call.module, call.method);
      const effectivePerCall = wantsBinary
        ? { ...perCall, responseType: 'blob' as const }
        : perCall;

      let data: unknown = await (fn as (input?: unknown, perCall?: unknown) => Promise<unknown>)(
        input,
        effectivePerCall,
      );
      // S12: optional response projection/redaction.
      if (options.transformResult) data = await options.transformResult(data, call, ctx);

      if (wantsBinary && isBinaryPayload(data)) {
        const disposition = options.binaryFilename?.(call, ctx);
        return {
          ok: true,
          binary: true,
          data,
          ...(typeof (data as Blob).type === 'string' && (data as Blob).type
            ? { contentType: (data as Blob).type }
            : {}),
          ...(disposition
            ? { contentDisposition: `attachment; filename="${sanitizeFilename(disposition)}"` }
            : {}),
        };
      }

      return { ok: true, data };
    } catch (error) {
      return fail(error, call);
    }
  };

  const handle = (payload: unknown, ctx: RpcRequestContext = {}): Promise<RpcHandledResponse> =>
    dispatchOne(payload, ctx);

  const handleBatch = async (
    payload: unknown,
    ctx: RpcRequestContext = {},
  ): Promise<RpcResponse[]> => {
    if (!isRpcBatchRequest(payload)) {
      return [fail(new RpcSecurityError('bad_payload', 400), null)];
    }
    const calls = payload.__rpcBatch;
    // S14: reject the WHOLE batch (before any dispatch) when empty or oversized.
    if (calls.length === 0 || calls.length > maxBatchSize) {
      return [fail(new RpcSecurityError('batch_too_large', 413), null)];
    }
    // S16: a batch may not nest another batch envelope.
    if (calls.some((c) => isRpcBatchRequest(c))) {
      return [fail(new RpcSecurityError('bad_payload', 400), null)];
    }
    // Each sub-call is fully, independently validated + dispatched; one failure
    // never affects its siblings (partial success is expected).
    const results = await Promise.all(calls.map((c) => dispatchOne(c, ctx)));
    // A batch is one JSON array, so a byte stream has nowhere to go in it.
    // Call a binary method on its own rather than silently JSON-mangling it.
    return results.map((r) =>
      isRpcBinaryOk(r) ? fail(new RpcSecurityError('binary_not_batchable', 400), null) : r,
    );
  };

  return { handle, handleBatch };
}
