import type { SchemaDiff } from '../types/openapi.types';
import { ApiError, type ApiErrorInit } from './ApiError';

/**
 * Thrown on schema drift detection mismatch in strict validation mode.
 *
 * @example
 * ```ts
 * import { SchemaError } from '@developerehsan/api-client'
 *
 * try {
 *   await api.pet.getPetById({ petId: 1 })
 * } catch (e) {
 *   if (e instanceof SchemaError) console.error('Response drifted from spec', e.diff)
 * }
 * ```
 */
export class SchemaError extends ApiError {
  override readonly name = 'SchemaError';
  readonly diff?: SchemaDiff;

  constructor(init: ApiErrorInit & { diff?: SchemaDiff }) {
    super(init);
    this.diff = init.diff;
  }

  override get isRetryable(): boolean {
    return false;
  }
}

/**
 * Thrown by the OpenAPI parser on malformed or unsupported specs.
 *
 * @example
 * ```ts
 * import { SchemaParseError } from '@developerehsan/api-client'
 *
 * try {
 *   await parseOpenApiSpec(rawSpec)
 * } catch (e) {
 *   if (e instanceof SchemaParseError) {
 *     console.error(`Invalid spec at line ${e.location?.line}: ${e.message}`)
 *   }
 * }
 * ```
 */
export class SchemaParseError extends ApiError {
  override readonly name = 'SchemaParseError';
  readonly location?: { line?: number; column?: number };

  constructor(init: ApiErrorInit & { location?: { line?: number; column?: number } }) {
    super(init);
    this.location = init.location;
  }

  override get isRetryable(): boolean {
    return false;
  }
}
