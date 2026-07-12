import { ApiError, type ApiErrorInit } from './ApiError'
import type { SchemaDiff } from '../types/openapi.types'

/** Thrown on schema drift detection mismatch in strict validation mode. */
export class SchemaError extends ApiError {
  override readonly name = 'SchemaError'
  readonly diff?: SchemaDiff

  constructor(init: ApiErrorInit & { diff?: SchemaDiff }) {
    super(init)
    this.diff = init.diff
  }

  override get isRetryable(): boolean {
    return false
  }
}

/** Thrown by the OpenAPI parser on malformed or unsupported specs. */
export class SchemaParseError extends ApiError {
  override readonly name = 'SchemaParseError'
  readonly location?: { line?: number; column?: number }

  constructor(init: ApiErrorInit & { location?: { line?: number; column?: number } }) {
    super(init)
    this.location = init.location
  }

  override get isRetryable(): boolean {
    return false
  }
}
