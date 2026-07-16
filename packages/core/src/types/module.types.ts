/**
 * Module system types: module shape, method contract, defineModule input.
 */

import type { ModuleConfig, PerCallConfig, ResolvedConfigSnapshot } from './config.types';
import type { ApiRequest, ApiResponse } from './http.types';
import type { PathParamsFor } from './path.types';

/** A minimal logger surface exposed on {@link ModuleContext.logger}. */
export interface ModuleLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Options for the generic operation runner {@link ModuleContext.run}. Everything
 * is opt-in and safe-by-default for arbitrary (possibly side-effecting) work:
 * dedup and retry are OFF unless requested; the queue follows the client
 * setting. Caching is intentionally not offered here (a request-response cache
 * would be unsound for arbitrary operations).
 */
export interface OperationOptions {
  /** Route through the client concurrency queue. Default: the client setting. */
  queue?: boolean;
  /**
   * Collapse identical concurrent operations (same key + `keyParts` + tenant +
   * auth) into one execution. Default `false` — enable only for idempotent work.
   */
  dedupe?: boolean;
  /** Per-attempt timeout (ms). Default: none. The signal is passed to `execute`. */
  timeout?: number;
  /** External cancellation. */
  signal?: AbortSignal;
  /** Retry policy. Default: a single attempt (no retry). */
  retry?: {
    attempts?: number;
    backoff?: 'exponential' | 'linear' | 'fixed';
    baseDelay?: number;
    maxDelay?: number;
    jitter?: boolean;
    /** Decide retryability. Default: retry only NetworkError / TimeoutError. */
    isRetryable?: (error: unknown) => boolean;
  };
  /** Extra values folded into the dedup key (canonically serialized). */
  keyParts?: unknown;
}

/**
 * Run arbitrary async work through the client's cross-cutting infrastructure
 * (concurrency queue, optional dedup, retry, timeout, cancellation) — the same
 * machinery `ctx.request` uses, but for non-HTTP module logic. `execute`
 * receives an `AbortSignal` reflecting the timeout/caller cancellation.
 */
export type OperationRunner = <T>(
  operationKey: string,
  execute: (signal?: AbortSignal) => Promise<T>,
  opts?: OperationOptions,
) => Promise<T>;

/**
 * The context handed to every custom module method. Provides the `request`
 * primitive (HTTP), the generic `run` primitive (any async work), access to
 * other modules for composed calls, module-scoped events/logging, and the
 * resolved module config.
 */
export interface ModuleContext {
  /**
   * Execute a raw request through the full lifecycle pipeline.
   *
   * `pathParams` is inferred from the literal `path`: a path with `{placeholders}`
   * REQUIRES exactly those keys (a missing/typo'd one is a compile error), while
   * a placeholder-free path forbids them. Non-literal (dynamic) paths fall back
   * to the loose record. The response type `T` is specified explicitly; the path
   * type is inferred, so `ctx.request<Invoice>({ method, path, pathParams })`
   * keeps working.
   */
  request<T = unknown, const P extends string = string>(
    spec: ModuleRequestSpecFor<P>,
    perCall?: PerCallConfig,
  ): Promise<ApiResponse<T>>;
  /**
   * Run arbitrary async work (not necessarily HTTP) with opt-in queue / dedup /
   * retry / timeout. This is how a module method does non-fetch logic while
   * still benefiting from the client's cross-cutting infrastructure.
   */
  run: OperationRunner;
  /** Access the whole client for composed cross-module calls. */
  readonly client: unknown;
  /** The resolved name of this module. */
  readonly moduleName: string;
  /**
   * Emit a custom event on the client bus, namespaced as
   * `module:<moduleName>:<event>`. Subscribe via `api.on(...)`.
   */
  emit(event: string, payload?: unknown): void;
  /** Module-scoped logger (honors the client `dev.logging` setting). */
  readonly logger: ModuleLogger;
  /** The effective, secret-redacted config resolved for this module. */
  config(): ResolvedConfigSnapshot;
}

/** A request spec whose `pathParams` are constrained by the literal path `P`. */
export type ModuleRequestSpecFor<P extends string> = {
  method: ApiRequest['method'];
  /** Path template, e.g. `/invoices/{id}`. */
  path: P;
  query?: Record<string, unknown>;
  body?: unknown;
} & PathParamsFor<P>;

/** The loose, non-path-constrained request spec (dynamic paths). */
export interface ModuleRequestSpec {
  method: ApiRequest['method'];
  /** Path template, e.g. `/invoices/{id}`. */
  path: string;
  pathParams?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: unknown;
}

/** A single method on a module. */
export type ModuleMethod = (this: void, ...args: never[]) => Promise<unknown>;

export type ModuleMethods = Record<
  string,
  (ctx: ModuleContext, ...args: never[]) => Promise<unknown>
>;

/**
 * Input to `defineModule`. Custom methods receive a {@link ModuleContext} as
 * their first argument, which is bound away before exposure on `api.*`.
 */
export interface ModuleDefinition<M extends ModuleMethods = ModuleMethods> {
  /**
   * `'auto'` inherits auto-derived methods from the OpenAPI tag of the same
   * name; omit or set a plain object to fully replace.
   */
  extends?: 'auto';
  config?: ModuleConfig;
  methods: M;
}

/** Strips the leading `ModuleContext` param from an exposed method. */
export type ExposedMethod<F> = F extends (ctx: ModuleContext, ...args: infer A) => infer R
  ? (...args: A) => R
  : never;

export type ExposedModule<M extends ModuleMethods> = {
  [K in keyof M]: ExposedMethod<M[K]>;
};
