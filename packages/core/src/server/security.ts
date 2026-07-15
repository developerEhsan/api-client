/**
 * Security primitives for the RPC handler. These enforce the threat-table
 * mitigations (S2, S4, S5, S6, S8) as small, independently-testable functions.
 * The handler composes them; the route adds S6 (body size) and S7 (CSRF).
 */

import { ApiError } from '../errors/ApiError';
import { isReservedMethodName } from '../factory/createModuleProxy';
import type { RpcErrorShape } from '../rpc/protocol';

/** Keys that must never appear as own properties of client-supplied input (S2). */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** Thrown for any request that fails a security check; message is generic (S9). */
export class RpcSecurityError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, status = 400) {
    super('The request could not be completed.');
    this.name = 'RpcSecurityError';
    this.code = code;
    this.status = status;
  }
}

/** A uniform "not available" denial, used for unknown/unauthorized alike (S1, S3, S9). */
export function notAvailable(): RpcSecurityError {
  return new RpcSecurityError('not_available', 404);
}

/** Validate that a name is a safe, non-reserved own identifier (S1, S2). */
export function isSafeName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && !isReservedMethodName(name);
}

/**
 * Recursively validate client input: bounded depth/breadth and no polluting keys
 * (S2, S6). Throws {@link RpcSecurityError} on violation. Arrays and plain
 * objects are walked; other values are leaves.
 */
export function assertSafeInput(
  value: unknown,
  maxDepth: number,
  maxKeys: number,
  depth = 0,
): void {
  if (depth > maxDepth) throw new RpcSecurityError('input_too_deep', 413);
  if (value === null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    if (value.length > maxKeys) throw new RpcSecurityError('input_too_large', 413);
    for (const item of value) assertSafeInput(item, maxDepth, maxKeys, depth + 1);
    return;
  }

  const keys = Object.keys(value);
  if (keys.length > maxKeys) throw new RpcSecurityError('input_too_large', 413);
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) throw new RpcSecurityError('forbidden_key', 400);
    assertSafeInput((value as Record<string, unknown>)[key], maxDepth, maxKeys, depth + 1);
  }
}

/** The only per-call options accepted from the wire, after clamping (S4). */
export interface SafePerCall {
  timeout?: number;
}

/**
 * Strip everything the client is not allowed to control (S4). `baseURL`,
 * `adapter`, `headers`, `auth`, and `signal` are dropped so the client cannot
 * redirect the server (SSRF) or inject auth. Only a clamped `timeout` survives.
 */
export function sanitizePerCall(raw: unknown, maxTimeout: number): SafePerCall {
  if (typeof raw !== 'object' || raw === null) return {};
  const timeout = (raw as { timeout?: unknown }).timeout;
  if (typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0) {
    return { timeout: Math.min(timeout, maxTimeout) };
  }
  return {};
}

/** Path params must be primitives so they can't smuggle structure into the URL (S5). */
export function assertPrimitivePathParams(input: unknown): void {
  if (typeof input !== 'object' || input === null) return;
  const pathParams = (input as { pathParams?: unknown }).pathParams;
  if (typeof pathParams !== 'object' || pathParams === null) return;
  for (const value of Object.values(pathParams as Record<string, unknown>)) {
    const t = typeof value;
    if (t !== 'string' && t !== 'number' && value !== undefined && value !== null) {
      throw new RpcSecurityError('invalid_path_param', 400);
    }
  }
}

/**
 * Project any thrown error onto the safe wire shape (S8). Stacks, request URLs,
 * response headers, and raw bodies never cross the boundary. `details` is
 * included only in dev.
 */
export function sanitizeError(error: unknown, dev: boolean): RpcErrorShape {
  if (error instanceof RpcSecurityError) {
    return {
      __rpcError: true,
      name: 'ApiError',
      status: error.status,
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof ApiError) {
    const shape: RpcErrorShape = {
      __rpcError: true,
      name: error.name,
      status: error.status,
      code: error.code,
      message: error.message,
    };
    if (dev && error.serverError) shape.details = error.serverError;
    return shape;
  }
  // Unknown/native error: never leak its message in production.
  return {
    __rpcError: true,
    name: 'ApiError',
    message: dev && error instanceof Error ? error.message : 'The request could not be completed.',
    code: 'internal_error',
  };
}
