/**
 * The browser half of the SSR RPC bridge. `createRpcClient` returns a proxy that
 * mirrors the exact `api.module.method(input, perCall?)` surface of the real
 * server client, but every call is serialized to `{ module, method, args }` and
 * handed to a `Transport` (a Server Action or an HTTP RPC route) — it makes no
 * direct request to the backend and holds no base URL, no paths, and no OpenAPI
 * data. Full type safety comes purely from `type Api = typeof serverApi`, which
 * is erased at build time.
 *
 * This module is dependency-free by design (only `ApiError`, which is small and
 * tree-shakeable) so the browser bundle stays lean.
 */

import { ApiError } from '../errors/ApiError';
import { type RpcCall, type RpcErrorShape, isRpcErrorShape } from '../rpc/protocol';
import type { RpcClient, Transport } from './types';

/** Rebuild a real `ApiError` from the sanitized wire shape so `instanceof` holds. */
function rehydrateError(shape: RpcErrorShape): ApiError {
  const error = new ApiError({
    message: shape.message,
    status: shape.status,
    code: shape.code,
    serverError:
      typeof shape.details === 'object' && shape.details !== null
        ? (shape.details as ApiError['serverError'])
        : null,
  });
  // Preserve the original subclass name (AuthError/TimeoutError/…) for display;
  // `name` is a readonly field, so define it directly.
  if (shape.name && shape.name !== error.name) {
    Object.defineProperty(error, 'name', {
      value: shape.name,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }
  return error;
}

/** Reserved keys the proxy must never treat as a module or method. */
const NON_METHOD_KEYS: ReadonlySet<string> = new Set([
  'then',
  'catch',
  'finally',
  'toJSON',
  'constructor',
  'prototype',
  '__proto__',
]);

/** Build a DOMException-shaped AbortError (falls back to a plain Error). */
function makeAbortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('The operation was aborted.', 'AbortError');
  }
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

/**
 * Create a typed RPC client bound to `transport`.
 *
 * @example
 * import { createRpcClient, serverActionTransport } from '@developerEhsan/api-client/browser'
 * import type { Api } from './server/api.config' // type-only — erased at build time
 * import { rpc } from './server/rpc'
 *
 * export const api = createRpcClient<Api>(serverActionTransport(rpc))
 * // full types, yet the browser sends only { module, method, args }:
 * await api.pet.getPetById({ petId: 1 }) // → Pet, no backend URL in the network tab
 */
export function createRpcClient<Api>(transport: Transport): RpcClient<Api> {
  const invoke = async (call: RpcCall): Promise<unknown> => {
    const response = await transport(call);
    if (response.ok) return response.data;
    throw rehydrateError(response.error);
  };

  /**
   * Invoke a method. A per-call `AbortSignal` (args[1].signal) is NOT sent over
   * the wire — it is neither JSON-serializable (breaks `httpTransport`) nor
   * structured-cloneable across a Server Action boundary (throws). Instead the
   * signal is stripped from the payload and honored locally: an abort rejects
   * the returned promise with an `AbortError`. The server call may still finish,
   * but its result is discarded — matching how a cancelled `fetch` behaves for
   * the caller.
   */
  const callMethod = (
    moduleName: string,
    methodName: string,
    args: unknown[],
  ): Promise<unknown> => {
    const perCall = args[1] as { signal?: AbortSignal } | undefined;
    const signal = perCall?.signal;

    let wireArgs = args;
    if (signal) {
      const { signal: _omit, ...rest } = perCall as Record<string, unknown>;
      wireArgs = Object.keys(rest).length > 0 ? [args[0], rest] : [args[0]];
    }
    const call: RpcCall = { module: moduleName, method: methodName, args: wireArgs };

    if (!signal) return invoke(call);
    if (signal.aborted) return Promise.reject(makeAbortError());
    return new Promise<unknown>((resolve, reject) => {
      const onAbort = (): void => reject(makeAbortError());
      signal.addEventListener('abort', onAbort, { once: true });
      invoke(call)
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', onAbort));
    });
  };

  const makeModule = (moduleName: string): Record<string, unknown> => {
    const cache = new Map<string, (...args: unknown[]) => Promise<unknown>>();
    return new Proxy(Object.create(null) as Record<string, unknown>, {
      get(_target, prop): unknown {
        if (typeof prop === 'symbol' || NON_METHOD_KEYS.has(prop)) return undefined;
        const methodName = prop;
        let fn = cache.get(methodName);
        if (!fn) {
          fn = (...args: unknown[]): Promise<unknown> => callMethod(moduleName, methodName, args);
          cache.set(methodName, fn);
        }
        return fn;
      },
      set: () => false,
    });
  };

  const moduleCache = new Map<string, Record<string, unknown>>();
  return new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, prop): unknown {
      if (typeof prop === 'symbol' || NON_METHOD_KEYS.has(prop)) return undefined;
      const moduleName = prop;
      let mod = moduleCache.get(moduleName);
      if (!mod) {
        mod = makeModule(moduleName);
        moduleCache.set(moduleName, mod);
      }
      return mod;
    },
    set: () => false,
  }) as RpcClient<Api>;
}

export { isRpcErrorShape };
