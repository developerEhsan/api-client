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
import type { RpcClient, RpcClientOptions, Transport } from './types';

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
 * import { createRpcClient, serverActionTransport } from '@developerehsan/api-client/browser'
 * import type { Api } from './server/api.config' // type-only — erased at build time
 * import { rpc } from './server/rpc'
 *
 * export const api = createRpcClient<Api>(serverActionTransport(rpc))
 * // full types, yet the browser sends only { module, method, args }:
 * await api.pet.getPetById({ petId: 1 }) // → Pet, no backend URL in the network tab
 */
export function createRpcClient<Api>(
  transport: Transport,
  options: RpcClientOptions = {},
): RpcClient<Api> {
  const batchFn = typeof transport.batch === 'function' ? transport.batch : undefined;
  const batchEnabled = options.batch === true && batchFn !== undefined;
  const maxBatchSize = options.maxBatchSize ?? 10;

  // Microtask coalescing queue (only used when batching is enabled).
  type Pending = { call: RpcCall; resolve: (v: unknown) => void; reject: (e: unknown) => void };
  let queue: Pending[] = [];
  let scheduled = false;

  const flush = (): void => {
    const batch = queue;
    queue = [];
    scheduled = false;
    // A lone call skips the envelope entirely (wire-compat + avoids the
    // 1-element "whole-batch failure" ambiguity).
    if (batch.length === 1) {
      const only = batch[0] as Pending;
      transport(only.call).then(
        (r) => (r.ok ? only.resolve(r.data) : only.reject(rehydrateError(r.error))),
        only.reject,
      );
      return;
    }
    if (!batchFn) return; // unreachable when batching is enabled; satisfies the type
    for (let i = 0; i < batch.length; i += maxBatchSize) {
      const chunk = batch.slice(i, i + maxBatchSize);
      batchFn(chunk.map((p) => p.call))
        .then((responses) => {
          for (let j = 0; j < chunk.length; j++) {
            const pending = chunk[j] as Pending;
            const r = responses[j];
            // A length mismatch means the whole batch failed server-side; fail
            // this entry rather than resolving it with an unrelated result.
            if (r === undefined) {
              pending.reject(
                rehydrateError({
                  __rpcError: true,
                  name: 'ApiError',
                  code: 'rpc_batch_error',
                  message: 'The request could not be completed.',
                }),
              );
            } else if (r.ok) pending.resolve(r.data);
            else pending.reject(rehydrateError(r.error));
          }
        })
        .catch((error: unknown) => {
          for (const pending of chunk) pending.reject(error);
        });
    }
  };

  const enqueue = (call: RpcCall): Promise<unknown> =>
    new Promise<unknown>((resolve, reject) => {
      queue.push({ call, resolve, reject });
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });

  const invokeSingle = async (call: RpcCall): Promise<unknown> => {
    const response = await transport(call);
    if (response.ok) return response.data;
    throw rehydrateError(response.error);
  };
  const invoke = (call: RpcCall): Promise<unknown> =>
    batchEnabled ? enqueue(call) : invokeSingle(call);

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
    // A signalled call is always sent individually (never coalesced) so local
    // cancellation stays precise.
    return new Promise<unknown>((resolve, reject) => {
      const onAbort = (): void => reject(makeAbortError());
      signal.addEventListener('abort', onAbort, { once: true });
      invokeSingle(call)
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
