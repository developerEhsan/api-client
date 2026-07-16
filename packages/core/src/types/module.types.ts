/**
 * Module system types: module shape, method contract, defineModule input.
 */

import type { ModuleConfig, PerCallConfig } from './config.types';
import type { ApiRequest, ApiResponse } from './http.types';
import type { PathParamsFor } from './path.types';

/**
 * The context handed to every custom module method. Provides a `request`
 * primitive that runs the full pipeline, plus access to other modules for
 * composed calls.
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
  /** Access the whole client for composed cross-module calls. */
  readonly client: unknown;
  /** The resolved name of this module. */
  readonly moduleName: string;
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
