/**
 * Wire protocol shared by the server RPC handler (`../server`) and the browser
 * RPC client (`../browser`). Everything here is types plus a couple of tiny
 * pure guards — it carries no runtime knowledge of backend URLs, paths, or the
 * OpenAPI document, so it is safe to include in a browser bundle.
 *
 * The envelope is intentionally uniform: `handle()` resolves to an `RpcResponse`
 * and never throws across the wire, so a Next.js Server Action (which turns a
 * thrown error into an opaque digest) still delivers a structured, rehydratable
 * error to the client.
 */

import type { ModuleName } from '../server/createRpcHandler';

/**
 * A single method invocation serialized from the browser proxy and validated
 * server-side.
 *
 * The generic `Api` is **optional** and defaults to `unknown`. Left off (the
 * common case — the wire type, the transport, the dynamic browser proxy), both
 * `module` and `method` are plain `string`, because the proxy cannot know the
 * concrete method at the call site. Pass a concrete `Api` (as the handler does
 * internally) and `module` narrows to the real module-name union for
 * autocomplete on `call.module` inside `authorize`/`onRequest`/`transformResult`.
 * `method` stays `string`: a per-module method type cannot be expressed on a
 * single flat wire object — that correlation lives in `expose` instead.
 *
 * @example
 * // The value the browser sends and the transport receives:
 * const call: RpcCall = { module: "pet", method: "getPetById", args: [{ petId: 1 }] };
 */
export interface RpcCall<Api = unknown> {
  /** Module name, e.g. `"pet"`. Validated against the allowlist server-side. */
  module: [ModuleName<Api>] extends [never] ? string : ModuleName<Api>;
  /** Method name, e.g. `"getPetById"`. */
  method: string;
  /** Positional args: `[input?, perCall?]`. `perCall` is sanitized server-side. */
  args: unknown[];
}

/** Safe, browser-facing projection of a thrown `ApiError` (see S8). */
export interface RpcErrorShape {
  readonly __rpcError: true;
  /** Original error class name (e.g. `"AuthError"`), informational only. */
  name: string;
  status?: number;
  code?: string;
  message: string;
  /** Structured detail — populated in dev only; stripped in production. */
  details?: unknown;
}

/** Successful result envelope. */
export interface RpcOk {
  ok: true;
  data: unknown;
}

/** Failure envelope carrying the sanitized error. */
export interface RpcErr {
  ok: false;
  error: RpcErrorShape;
}

/** Uniform result of a handled RPC call. `handle()` never rejects with this. */
export type RpcResponse = RpcOk | RpcErr;

/**
 * A batch of calls coalesced by the browser client into one round-trip. The
 * server validates and dispatches each sub-call INDIVIDUALLY (allowlist +
 * authorize + input caps run per entry), so batching is never an allowlist
 * bypass. Responses come back positionally as `RpcResponse[]`.
 */
export interface RpcBatchRequest {
  __rpcBatch: RpcCall[];
}

/** Type guard for a batch envelope (used by the server to route the payload). */
export function isRpcBatchRequest(value: unknown): value is RpcBatchRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { __rpcBatch?: unknown }).__rpcBatch)
  );
}

/** Type guard for the sanitized error shape. */
export function isRpcErrorShape(value: unknown): value is RpcErrorShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __rpcError?: unknown }).__rpcError === true
  );
}

/** Type guard for the response envelope. */
export function isRpcResponse(value: unknown): value is RpcResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  );
}
