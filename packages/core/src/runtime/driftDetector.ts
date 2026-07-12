/**
 * Schema drift detection. Compares two schema snapshots (e.g. previous vs newly
 * refreshed, or generated vs runtime) and produces a field-level {@link SchemaDiff};
 * `handleDrift` applies the configured policy — throw in strict mode, warn +
 * callback in loose mode (spec S4/S5).
 */
import type { OperationNode, SchemaAST, SchemaDiff } from '../types/openapi.types'
import { SchemaError } from '../errors/SchemaError'
import { stableHash } from '../utilities/hash'

/** Stable hash of the operation surface (ids, methods, paths, params, responses). */
export function hashSchema(ast: SchemaAST): string {
  const signature = Object.keys(ast.operations)
    .sort()
    .map((id) => operationSignature(ast.operations[id]))
  return stableHash(signature)
}

function operationSignature(op: OperationNode | undefined): unknown {
  if (!op) return null
  return {
    id: op.id,
    method: op.method,
    path: op.path,
    params: op.parameters
      .map((p) => `${p.in}:${p.name}:${p.required ? 'req' : 'opt'}:${typeSig(p.type)}`)
      .sort(),
    // Capture the request/response body TYPES, not just presence/status keys,
    // so a field added/removed/retyped in a body is detected as drift (S4/S5).
    body: op.requestBody ? { required: op.requestBody.required, type: typeSig(op.requestBody.type) } : null,
    responses: Object.keys(op.responses)
      .sort()
      .map((status) => `${status}:${typeSig(op.responses[status])}`),
  }
}

/** Stable structural fingerprint of a type node (nested refs/props included). */
function typeSig(type: import('../types/openapi.types').TypeNode | undefined): string {
  return type ? stableHash(type) : 'none'
}

/** Compute the field-level diff between two schemas. */
export function diffSchemas(prev: SchemaAST, next: SchemaAST): SchemaDiff {
  const prevIds = new Set(Object.keys(prev.operations))
  const nextIds = new Set(Object.keys(next.operations))

  const addedOperations = [...nextIds].filter((id) => !prevIds.has(id)).sort()
  const removedOperations = [...prevIds].filter((id) => !nextIds.has(id)).sort()

  const changedOperations: { id: string; reason: string }[] = []
  for (const id of [...nextIds].filter((x) => prevIds.has(x)).sort()) {
    const before = stableHash(operationSignature(prev.operations[id]))
    const after = stableHash(operationSignature(next.operations[id]))
    if (before !== after) {
      changedOperations.push({ id, reason: 'operation signature changed' })
    }
  }

  return {
    addedOperations,
    removedOperations,
    changedOperations,
    hashChanged: hashSchema(prev) !== hashSchema(next),
  }
}

/** True when a diff represents any drift at all. */
export function hasDrift(diff: SchemaDiff): boolean {
  return (
    diff.hashChanged ||
    diff.addedOperations.length > 0 ||
    diff.removedOperations.length > 0 ||
    diff.changedOperations.length > 0
  )
}

export interface DriftPolicy {
  mode?: 'strict' | 'loose'
  onDriftDetected?: (diff: SchemaDiff) => void
}

/**
 * Apply the drift policy. Strict mode throws {@link SchemaError}; loose mode
 * invokes `onDriftDetected` (or warns) and continues. No-op when there is no
 * drift.
 */
export function handleDrift(diff: SchemaDiff, policy: DriftPolicy): void {
  if (!hasDrift(diff)) return

  if (policy.onDriftDetected) {
    policy.onDriftDetected(diff)
  }

  if (policy.mode === 'strict') {
    throw new SchemaError({
      message:
        `OpenAPI schema drift detected: ` +
        `+${diff.addedOperations.length} added, ` +
        `-${diff.removedOperations.length} removed, ` +
        `~${diff.changedOperations.length} changed operations.`,
      diff,
    })
  }

  if (!policy.onDriftDetected) {
    console.warn(
      `[@developerEhsan/api-client] OpenAPI schema drift detected ` +
        `(+${diff.addedOperations.length}/-${diff.removedOperations.length}/` +
        `~${diff.changedOperations.length}). Regenerate types to stay in sync.`,
    )
  }
}
