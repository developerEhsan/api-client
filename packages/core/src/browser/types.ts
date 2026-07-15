/**
 * Type-level mapping for the browser RPC client. `RpcClient<Api>` reproduces the
 * real client's `module.method(input, perCall?)` signatures from `Api = typeof
 * serverApi` — a type-only import, so no path/URL/OpenAPI data crosses into the
 * browser bundle.
 */

import type { RpcCall, RpcResponse } from '../rpc/protocol';

/**
 * Per-call options a browser caller may pass as the 2nd argument to a bridged
 * method (`api.pet.getPetById(input, perCall)`). Deliberately minimal — the
 * server drops everything else it receives (S4), so only these two matter.
 */
export interface RpcPerCall {
  /**
   * Cancel this call. Handled entirely on the client: it is **not** sent over
   * the wire (an `AbortSignal` is neither JSON-serializable nor cloneable across
   * a Server Action). Aborting rejects the returned promise with an
   * `AbortError`; the in-flight server call may still complete but its result is
   * discarded.
   * @default undefined (no cancellation)
   */
  signal?: AbortSignal;
  /**
   * Per-call request timeout in milliseconds, forwarded to the server and
   * **clamped** there to the handler's `maxTimeout` (default 30000). Values
   * <= 0 or non-finite are ignored.
   * @default undefined (falls back to the server client's module/global timeout, 10000ms)
   */
  timeout?: number;
}

/**
 * A transport turns a serialized {@link RpcCall} into a response envelope. It
 * must resolve (never reject) for application-level errors — those travel
 * inside the `{ ok: false, error }` envelope so the client can rehydrate a real
 * `ApiError`. It may reject only for genuine transport failures.
 */
export type Transport = (call: RpcCall) => Promise<RpcResponse>;

/** Keys on the real client that are not callable RPC modules. */
type ReservedClientKey = 'cache' | 'config' | 'setEnvironment' | 'getSchema' | 'on' | 'off';

/** True when `M`'s value looks like a module (an object of methods), not a client utility. */
type IsModule<T> = T extends (...args: never[]) => unknown
  ? false
  : T extends object
    ? true
    : false;

/** Map one module's methods to `(input?, perCall?) => Promise<Result>`. */
type RpcModule<Mod> = {
  [K in keyof Mod]: Mod[K] extends (input: infer I, ...rest: never[]) => Promise<infer R>
    ? (input?: I, perCall?: RpcPerCall) => Promise<R>
    : Mod[K] extends (...args: never[]) => Promise<infer R>
      ? (perCall?: RpcPerCall) => Promise<R>
      : never;
};

/** The exposed browser client: every real module, RPC-shaped; utilities dropped. */
export type RpcClient<Api> = {
  [M in keyof Api as M extends ReservedClientKey
    ? never
    : IsModule<Api[M]> extends true
      ? M
      : never]: RpcModule<Api[M]>;
};
