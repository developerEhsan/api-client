/**
 * Compose lifecycle hooks across the global -> module -> per-call layers.
 *
 * Semantics (all levels fire, most-specific last):
 *  - Transforming hooks (`onRequest`, `onResponse`) are CHAINED: each level
 *    receives the previous level's output; returning `undefined`/`void` passes
 *    the value through unchanged.
 *  - Notification hooks (`onError`, `onRetry`, `onCacheHit`, `onCacheMiss`,
 *    `onSuccess`, `onSettled`) FAN OUT: every level fires, in order, awaited
 *    sequentially so ordering is deterministic. A throwing notification hook is
 *    caught and routed to `onHookError` — it never breaks the pipeline.
 *
 * The result is a set of always-callable functions (no-ops when no level
 * registered that hook), so call sites need no per-hook presence checks. When no
 * layer defines any hook, a shared frozen no-op set is returned to avoid
 * per-request allocation.
 */
import type { ApiError } from '../errors/ApiError';
import type { CacheEntry } from '../types/cache.types';
import type { LifecycleHooks } from '../types/config.types';
import type { ApiRequest, ApiResponse } from '../types/http.types';

/** Fully-composed, always-callable hook set used by the pipeline. */
export interface ComposedHooks {
  onRequest(request: ApiRequest): Promise<ApiRequest>;
  onResponse<T>(response: ApiResponse<T>): Promise<ApiResponse<T>>;
  onError(error: ApiError): Promise<void>;
  onRetry(attempt: number, error: ApiError): void;
  onCacheHit(key: string, entry: CacheEntry): void;
  onCacheMiss(key: string): void;
  onSuccess<T>(response: ApiResponse<T>): Promise<void>;
  onSettled<T>(response: ApiResponse<T> | undefined, error: ApiError | undefined): Promise<void>;
}

/** Reports a notification-hook failure without breaking the request. */
export type HookErrorReporter = (hook: keyof LifecycleHooks, error: unknown) => void;

// Typed before freezing so the object literal is contextually typed by
// `ComposedHooks` (Object.freeze's generic would otherwise widen params to any).
const NOOP_HOOKS_IMPL: ComposedHooks = {
  async onRequest(request) {
    return request;
  },
  async onResponse(response) {
    return response;
  },
  async onError() {},
  onRetry() {},
  onCacheHit() {},
  onCacheMiss() {},
  async onSuccess() {},
  async onSettled() {},
};
const NOOP_HOOKS: ComposedHooks = Object.freeze(NOOP_HOOKS_IMPL);

/** Collect the defined implementations of one hook across layers, in order. */
function collect<K extends keyof LifecycleHooks>(
  layers: (LifecycleHooks | undefined)[],
  key: K,
): NonNullable<LifecycleHooks[K]>[] {
  const out: NonNullable<LifecycleHooks[K]>[] = [];
  for (const layer of layers) {
    const fn = layer?.[key];
    if (typeof fn === 'function') out.push(fn as NonNullable<LifecycleHooks[K]>);
  }
  return out;
}

/**
 * Build the composed hook set for one request from its ordered config layers
 * (`[global, module, perCall]`). `onHookError` receives any error thrown by a
 * notification hook.
 */
export function composeHooks(
  layers: (LifecycleHooks | undefined)[],
  onHookError: HookErrorReporter = () => {},
): ComposedHooks {
  if (layers.every((l) => l === undefined || Object.keys(l).length === 0)) {
    return NOOP_HOOKS;
  }

  const onRequestFns = collect(layers, 'onRequest');
  const onResponseFns = collect(layers, 'onResponse');
  const onErrorFns = collect(layers, 'onError');
  const onRetryFns = collect(layers, 'onRetry');
  const onCacheHitFns = collect(layers, 'onCacheHit');
  const onCacheMissFns = collect(layers, 'onCacheMiss');
  const onSuccessFns = collect(layers, 'onSuccess');
  const onSettledFns = collect(layers, 'onSettled');

  return {
    async onRequest(request) {
      let current = request;
      for (const fn of onRequestFns) {
        const next = await fn(current);
        if (next !== undefined) current = next;
      }
      return current;
    },
    async onResponse(response) {
      let current = response;
      for (const fn of onResponseFns) {
        const next = await fn(current);
        if (next !== undefined) current = next as typeof current;
      }
      return current;
    },
    async onError(error) {
      for (const fn of onErrorFns) {
        try {
          await fn(error);
        } catch (hookError) {
          onHookError('onError', hookError);
        }
      }
    },
    onRetry(attempt, error) {
      for (const fn of onRetryFns) {
        try {
          fn(attempt, error);
        } catch (hookError) {
          onHookError('onRetry', hookError);
        }
      }
    },
    onCacheHit(key, entry) {
      for (const fn of onCacheHitFns) {
        try {
          fn(key, entry);
        } catch (hookError) {
          onHookError('onCacheHit', hookError);
        }
      }
    },
    onCacheMiss(key) {
      for (const fn of onCacheMissFns) {
        try {
          fn(key);
        } catch (hookError) {
          onHookError('onCacheMiss', hookError);
        }
      }
    },
    async onSuccess(response) {
      for (const fn of onSuccessFns) {
        try {
          await fn(response);
        } catch (hookError) {
          onHookError('onSuccess', hookError);
        }
      }
    },
    async onSettled(response, error) {
      for (const fn of onSettledFns) {
        try {
          await fn(response, error);
        } catch (hookError) {
          onHookError('onSettled', hookError);
        }
      }
    },
  };
}
