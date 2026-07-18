/**
 * Derive auto-method descriptors for a module from a runtime-loaded
 * {@link SchemaAST}. This mirrors what the build-time codegen module emitter
 * produces (method name = operationId, plus its verb + path), so a module
 * declared with `extends: 'auto'` gains the same methods at runtime once the
 * spec has loaded — without a build step.
 */
import type { AutoMethodDescriptor } from '../factory/createModuleProxy';
import type { SchemaAST } from '../types/openapi.types';

/**
 * Descriptors for every operation grouped under the tag named `moduleName`.
 * Returns an empty object when the schema has no such tag.
 */
export function deriveAutoDescriptors(
  ast: SchemaAST,
  moduleName: string,
): Record<string, AutoMethodDescriptor> {
  const out: Record<string, AutoMethodDescriptor> = {};
  const operationIds = ast.tags[moduleName] ?? [];
  for (const id of operationIds) {
    const op = ast.operations[id];
    if (!op) continue;
    out[op.id] = { method: op.method, path: op.path };
  }
  return out;
}
