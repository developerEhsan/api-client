/**
 * Pure string emitter that renders a {@link SchemaAST} into the TypeScript
 * source for `generated/api.types.ts`. No file IO, no clock access — the
 * `generatedAt` / `sourceHash` banner fields are supplied by the caller so
 * output is fully deterministic for a given AST + options.
 *
 * Emission scheme (documented in the generated banner as well):
 * - Each component schema becomes `export interface X {}` when it is an object
 *   with named properties, otherwise `export type X = ...`.
 * - All operations are collected into a single `export interface OperationsMap`
 *   keyed by operationId, each entry exposing `{ params; query; body; response }`.
 * - `export type ApiPaths` mirrors the PathMap (path -> method -> operationId).
 * - Component names, object keys, operation ids, and path keys are sorted so
 *   the emitted file is byte-stable across runs.
 */

import type { HttpMethod } from '../types/http.types';
import type {
  OperationNode,
  ParameterNode,
  PropertyNode,
  SchemaAST,
  TypeNode,
} from '../types/openapi.types';

/** Options controlling the generated file banner. */
export interface EmitTypesOptions {
  /** ISO timestamp recorded in the banner. Caller-supplied; never read here. */
  generatedAt?: string;
  /** Hash of the source OpenAPI document, recorded in the banner. */
  sourceHash?: string;
}

const INDENT = '  ';

/** Render a TypeNode to a TS type expression at the given indent depth. */
function emitTypeNode(node: TypeNode, depth: number): string {
  switch (node.kind) {
    case 'primitive': {
      if (node.enum && node.enum.length > 0) {
        return node.enum.map(literal).join(' | ');
      }
      return node.type === 'null' ? 'null' : node.type;
    }
    case 'array': {
      const inner = emitTypeNode(node.items, depth);
      return needsParens(node.items) ? `Array<${inner}>` : `${inner}[]`;
    }
    case 'object':
      return emitObject(node, depth);
    case 'union': {
      if (node.variants.length === 0) return 'never';
      return node.variants
        .map((v) => (needsParens(v) ? `(${emitTypeNode(v, depth)})` : emitTypeNode(v, depth)))
        .join(' | ');
    }
    case 'intersection': {
      if (node.parts.length === 0) return 'unknown';
      return node.parts
        .map((p) => (needsParens(p) ? `(${emitTypeNode(p, depth)})` : emitTypeNode(p, depth)))
        .join(' & ');
    }
    case 'ref':
      return sanitizeIdentifier(node.name);
    case 'unknown':
      return 'unknown';
  }
}

/** Whether a node must be parenthesised when composed into unions/arrays. */
function needsParens(node: TypeNode): boolean {
  if (node.kind === 'union' || node.kind === 'intersection') return true;
  // An enum primitive emits multiple `|`-joined literals, so it needs parens in
  // array position: `('a' | 'b')[]`, not `'a' | 'b'[]`.
  if (node.kind === 'primitive' && node.enum && node.enum.length > 1) return true;
  return false;
}

/** Render an object TypeNode as an inline `{ ... }` type literal. */
function emitObject(node: Extract<TypeNode, { kind: 'object' }>, depth: number): string {
  const keys = Object.keys(node.properties).sort();
  const lines: string[] = [];
  const pad = INDENT.repeat(depth + 1);

  for (const key of keys) {
    const prop = node.properties[key];
    if (!prop) continue;
    if (prop.description) {
      lines.push(`${pad}/** ${escapeComment(prop.description)} */`);
    }
    const optional = prop.required ? '' : '?';
    const value = emitTypeNode(prop.type, depth + 1);
    lines.push(`${pad}${propKey(key)}${optional}: ${value}`);
  }

  if (node.additionalProperties) {
    const value =
      node.additionalProperties === true
        ? 'unknown'
        : emitTypeNode(node.additionalProperties, depth + 1);
    lines.push(`${pad}[key: string]: ${value}`);
  }

  if (lines.length === 0) return '{}';
  return `{\n${lines.join('\n')}\n${INDENT.repeat(depth)}}`;
}

/** Pick the 2xx response type for an operation, falling back to `default`/unknown. */
function successResponse(op: OperationNode): TypeNode {
  const codes = Object.keys(op.responses).sort();
  const twoXx = codes.find((c) => /^2\d\d$/.test(c));
  const chosen = twoXx ?? (op.responses['default'] ? 'default' : codes[0]);
  if (chosen && op.responses[chosen]) return op.responses[chosen];
  return { kind: 'unknown', reason: 'no response schema' };
}

/** Build an object TypeNode from parameters filtered by their `in` location. */
function paramsObject(
  params: ParameterNode[],
  location: ParameterNode['in'],
): Extract<TypeNode, { kind: 'object' }> {
  const properties: Record<string, PropertyNode> = {};
  for (const p of params) {
    if (p.in !== location) continue;
    properties[p.name] = {
      type: p.type,
      required: p.required,
      ...(p.description ? { description: p.description } : {}),
    };
  }
  return { kind: 'object', properties };
}

/** Emit the single per-operation entry body: `{ params; query; body; response }`. */
function emitOperationEntry(op: OperationNode, depth: number): string {
  const pad = INDENT.repeat(depth + 1);
  const params = emitObject(paramsObject(op.parameters, 'path'), depth + 1);
  const query = emitObject(paramsObject(op.parameters, 'query'), depth + 1);
  const body = op.requestBody ? emitTypeNode(op.requestBody.type, depth + 1) : 'never';
  const response = emitTypeNode(successResponse(op), depth + 1);

  return [
    '{',
    `${pad}params: ${params}`,
    `${pad}query: ${query}`,
    `${pad}body: ${body}`,
    `${pad}response: ${response}`,
    `${INDENT.repeat(depth)}}`,
  ].join('\n');
}

/** Emit `export interface OperationsMap { ... }`. */
function emitOperationsMap(ast: SchemaAST): string {
  const ids = Object.keys(ast.operations).sort();
  const lines: string[] = ['export interface OperationsMap {'];
  for (const id of ids) {
    const op = ast.operations[id];
    if (!op) continue;
    if (op.deprecated) lines.push(`${INDENT}/** @deprecated */`);
    else if (op.summary) lines.push(`${INDENT}/** ${escapeComment(op.summary)} */`);
    lines.push(`${INDENT}${propKey(id)}: ${emitOperationEntry(op, 1)}`);
  }
  lines.push('}');
  return lines.join('\n');
}

/** Emit `export type ApiPaths` mirroring the PathMap. */
function emitApiPaths(ast: SchemaAST): string {
  const paths = Object.keys(ast.paths).sort();
  const lines: string[] = ['export type ApiPaths = {'];
  for (const path of paths) {
    const methods = ast.paths[path];
    if (!methods) continue;
    const methodKeys = (Object.keys(methods) as HttpMethod[]).sort();
    const inner = methodKeys
      .map((m) => `${INDENT.repeat(2)}${m}: ${literal(methods[m] ?? '')}`)
      .join('\n');
    if (inner === '') {
      lines.push(`${INDENT}${literal(path)}: {}`);
    } else {
      lines.push(`${INDENT}${literal(path)}: {\n${inner}\n${INDENT}}`);
    }
  }
  lines.push('}');
  return lines.join('\n');
}

/** Emit a single component as an interface (objects) or a type alias. */
function emitComponent(name: string, node: TypeNode): string {
  const id = sanitizeIdentifier(name);
  if (node.kind === 'object') {
    return `export interface ${id} ${emitObject(node, 0)}`;
  }
  return `export type ${id} = ${emitTypeNode(node, 0)}`;
}

/** Build the AUTO-GENERATED banner (spec 8.3). */
function emitBanner(ast: SchemaAST, opts: EmitTypesOptions): string {
  return [
    '/**',
    ' * AUTO-GENERATED — DO NOT EDIT.',
    ' *',
    ' * Regenerate via the @developerehsan/api-client codegen; manual edits are lost.',
    ` * source: ${ast.info.title} v${ast.info.version} (OpenAPI ${ast.openapiVersion})`,
    ` * generatedAt: ${opts.generatedAt ?? ''}`,
    ` * sourceHash: ${opts.sourceHash ?? ''}`,
    ' *',
    ' * Emission scheme:',
    ' *  - components -> `export interface`/`export type`',
    ' *  - operations -> one `export interface OperationsMap` keyed by operationId,',
    ' *    each entry `{ params; query; body; response }`',
    ' *  - `export type ApiPaths` mirrors path -> method -> operationId',
    ' */',
  ].join('\n');
}

/**
 * Render the full `generated/api.types.ts` source for the given schema AST.
 *
 * @param ast - Normalized schema produced by the OpenAPI parser.
 * @param opts - Banner metadata; `generatedAt` must be supplied by the caller
 *   (this function never reads the clock) and defaults to an empty string.
 * @returns Deterministic TypeScript source, ending with a trailing newline.
 */
export function emitTypes(ast: SchemaAST, opts: EmitTypesOptions = {}): string {
  const blocks: string[] = [emitBanner(ast, opts)];

  const componentNames = Object.keys(ast.components).sort();
  for (const name of componentNames) {
    const node = ast.components[name];
    if (!node) continue;
    blocks.push(emitComponent(name, node));
  }

  blocks.push(emitOperationsMap(ast));
  blocks.push(emitApiPaths(ast));

  return `${blocks.join('\n\n')}\n`;
}

/** Render a string/number as a TS literal type. */
function literal(value: string | number): string {
  return typeof value === 'number' ? String(value) : JSON.stringify(value);
}

/** Quote an object key only when it is not a valid bare identifier. */
function propKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

/** Coerce an arbitrary schema name into a valid TS type identifier. */
function sanitizeIdentifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[A-Za-z_$]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

/** Neutralize comment terminators inside JSDoc passthrough text. */
function escapeComment(text: string): string {
  return text.replace(/\*\//g, '*\\/').replace(/[\r\n]+/g, ' ');
}
