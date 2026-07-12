/**
 * Runtime response validation built from the {@link SchemaAST}. The validator
 * is dependency-free — it checks values structurally against a {@link TypeNode},
 * so response validation works without the optional `zod` peer dependency.
 */
import type {
  OperationNode,
  SchemaAST,
  TypeNode,
} from '../types/openapi.types'

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

const OK: ValidationResult = { valid: true, errors: [] }

/** Validate a value against a {@link TypeNode}, resolving `$ref`s via the AST. */
export function validateValue(
  value: unknown,
  type: TypeNode,
  ast: SchemaAST,
  path = '$',
  seen: Set<string> = new Set(),
): ValidationResult {
  switch (type.kind) {
    case 'unknown':
      return OK // opaque node (circular/unsupported) — accept anything.

    case 'primitive': {
      if (type.type === 'null') {
        return value === null ? OK : fail(path, 'null', value)
      }
      if (value === null || value === undefined) return fail(path, type.type, value)
      if (type.type === 'string' && typeof value !== 'string') return fail(path, 'string', value)
      if (type.type === 'number' && typeof value !== 'number') return fail(path, 'number', value)
      if (type.type === 'boolean' && typeof value !== 'boolean') return fail(path, 'boolean', value)
      if (type.enum && !type.enum.includes(value as string | number)) {
        return { valid: false, errors: [`${path}: ${JSON.stringify(value)} not in enum`] }
      }
      return OK
    }

    case 'array': {
      if (!Array.isArray(value)) return fail(path, 'array', value)
      const errors: string[] = []
      value.forEach((item, i) => {
        const r = validateValue(item, type.items, ast, `${path}[${i}]`, seen)
        if (!r.valid) errors.push(...r.errors)
      })
      return errors.length ? { valid: false, errors } : OK
    }

    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail(path, 'object', value)
      }
      const record = value as Record<string, unknown>
      const errors: string[] = []
      for (const [key, prop] of Object.entries(type.properties)) {
        const present = key in record
        if (!present) {
          if (prop.required) errors.push(`${path}.${key}: required property missing`)
          continue
        }
        const r = validateValue(record[key], prop.type, ast, `${path}.${key}`, seen)
        if (!r.valid) errors.push(...r.errors)
      }
      // Enforce additionalProperties: `false` forbids unknown keys; a TypeNode
      // constrains their value type. `true`/undefined allows anything.
      const extra = type.additionalProperties
      if (extra === false || (extra !== undefined && extra !== true)) {
        for (const key of Object.keys(record)) {
          if (key in type.properties) continue
          if (extra === false) {
            errors.push(`${path}.${key}: additional property not allowed`)
          } else {
            const r = validateValue(record[key], extra, ast, `${path}.${key}`, seen)
            if (!r.valid) errors.push(...r.errors)
          }
        }
      }
      return errors.length ? { valid: false, errors } : OK
    }

    case 'union': {
      // Valid if it matches ANY variant (spec S8).
      for (const variant of type.variants) {
        if (validateValue(value, variant, ast, path, seen).valid) return OK
      }
      return { valid: false, errors: [`${path}: matched no union variant`] }
    }

    case 'intersection': {
      const errors: string[] = []
      for (const part of type.parts) {
        const r = validateValue(value, part, ast, path, seen)
        if (!r.valid) errors.push(...r.errors)
      }
      return errors.length ? { valid: false, errors } : OK
    }

    case 'ref': {
      // Guard against circular refs.
      if (seen.has(type.name)) return OK
      const resolved = ast.components[type.name]
      if (!resolved) return OK // unknown component — accept.
      const next = new Set(seen)
      next.add(type.name)
      return validateValue(value, resolved, ast, path, next)
    }
  }
}

function fail(path: string, expected: string, value: unknown): ValidationResult {
  return { valid: false, errors: [`${path}: expected ${expected}, got ${describe(value)}`] }
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Look up the response TypeNode for an operation + status (falls back to 2xx/default). */
export function responseTypeFor(
  op: OperationNode,
  status: number,
): TypeNode | undefined {
  return (
    op.responses[String(status)] ??
    op.responses[`${Math.floor(status / 100)}XX`] ??
    op.responses['default'] ??
    (status >= 200 && status < 300 ? firstSuccess(op) : undefined)
  )
}

function firstSuccess(op: OperationNode): TypeNode | undefined {
  const key = Object.keys(op.responses).find((k) => /^2\d\d$/.test(k))
  return key ? op.responses[key] : undefined
}

/**
 * Resolve the operation for a (path template, method) pair and validate a
 * response body against its declared response type. Returns a valid result when
 * the operation or response type cannot be resolved (nothing to check against).
 */
export function validateResponseBody(
  ast: SchemaAST,
  pathTemplate: string,
  method: string,
  status: number,
  body: unknown,
): ValidationResult {
  const operationId = ast.paths[pathTemplate]?.[method.toUpperCase() as keyof (typeof ast.paths)[string]]
  if (!operationId) return OK
  const op = ast.operations[operationId]
  if (!op) return OK
  const type = responseTypeFor(op, status)
  if (!type) return OK
  return validateValue(body, type, ast)
}
