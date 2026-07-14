/**
 * Module emitter — turns a {@link SchemaAST} into the source of
 * `generated/api.modules.ts`: a data descriptor (`generatedModules`) grouping
 * operations by tag that the runtime consumes to build auto-modules.
 *
 * Pure string generation. No executable request code is emitted here.
 */

import type { OperationNode, SchemaAST } from '../types/openapi.types';

/** Client members a module name must not collide with (spec M1). */
const RESERVED_MEMBERS = new Set<string>([
  'cache',
  'config',
  'setEnvironment',
  'getSchema',
  'on',
  'off',
]);

export interface EmitModulesOptions {
  generatedAt?: string;
  sourceHash?: string;
}

/** A single emitted module: its property name plus any warning to annotate. */
interface EmittedModule {
  /** Original tag name. */
  tag: string;
  /** Property name used in the descriptor (may be renamed for reserved tags). */
  name: string;
  /** Warning comment text, if the tag was renamed. */
  warning?: string;
}

/**
 * Emit the source for `generated/api.modules.ts`.
 *
 * @param ast - The normalized schema AST.
 * @param opts - Optional banner metadata (generation timestamp, source hash).
 * @returns TypeScript source as a string.
 */
export function emitModules(ast: SchemaAST, opts: EmitModulesOptions = {}): string {
  const banner = emitBanner(ast, opts);

  const tags = Object.keys(ast.tags).sort();
  const blocks: string[] = [];

  for (const tag of tags) {
    const mod = resolveModuleName(tag);
    const operationIds = [...ast.tags[tag]!].sort();

    const methodLines: string[] = [];
    const seen = new Set<string>();
    for (const opId of operationIds) {
      const op = ast.operations[opId];
      if (!op) continue;
      let method = deriveMethodName(opId, tag);
      // Guard against collisions after camelCasing / prefix stripping.
      let unique = method;
      let n = 2;
      while (seen.has(unique)) unique = `${method}${n++}`;
      method = unique;
      seen.add(method);
      methodLines.push(`      ${quoteKey(method)}: ${emitDescriptor(op)},`);
    }

    const parts: string[] = [];
    if (mod.warning) parts.push(`    // warning: ${mod.warning}`);
    parts.push(`    ${quoteKey(mod.name)}: {`);
    parts.push(...methodLines);
    parts.push('    },');
    blocks.push(parts.join('\n'));
  }

  const body = blocks.length > 0 ? `\n${blocks.join('\n')}\n  ` : '';

  return `${banner}\n\n/** Data descriptor consumed by the runtime to build auto-modules per tag. */\nexport const generatedModules = {${body}} as const\n\nexport type GeneratedModules = typeof generatedModules\n`;
}

/**
 * Emit the source for `generated/api.rpc.ts` — a **paths-stripped** descriptor
 * (`rpcModules`) safe to import into a client component behind the SSR RPC
 * bridge. It keeps only what the TanStack Query integration needs (the HTTP
 * verb, whether the path is parameterized, and pagination) and **omits `path`
 * and `operationId`**, so no backend path string ever ships to the browser.
 *
 * The module/method names match `api.modules.ts` exactly (same resolution), so
 * `createQueryIntegration(rpcClient, { modules: rpcModules })` lines up.
 */
export function emitRpcModules(ast: SchemaAST, opts: EmitModulesOptions = {}): string {
  const banner = emitBanner(ast, opts);
  const tags = Object.keys(ast.tags).sort();
  const blocks: string[] = [];

  for (const tag of tags) {
    const mod = resolveModuleName(tag);
    const operationIds = [...ast.tags[tag]!].sort();
    const methodLines: string[] = [];
    const seen = new Set<string>();
    for (const opId of operationIds) {
      const op = ast.operations[opId];
      if (!op) continue;
      let method = deriveMethodName(opId, tag);
      let unique = method;
      let n = 2;
      while (seen.has(unique)) unique = `${method}${n++}`;
      method = unique;
      seen.add(method);
      methodLines.push(`      ${quoteKey(method)}: ${emitRpcDescriptor(op)},`);
    }
    const parts: string[] = [];
    if (mod.warning) parts.push(`    // warning: ${mod.warning}`);
    parts.push(`    ${quoteKey(mod.name)}: {`);
    parts.push(...methodLines);
    parts.push('    },');
    blocks.push(parts.join('\n'));
  }

  const body = blocks.length > 0 ? `\n${blocks.join('\n')}\n  ` : '';
  return `${banner}\n\n/** Paths-stripped descriptor for the browser RPC bridge (no backend paths). */\nexport const rpcModules = {${body}} as const\n\nexport type RpcModules = typeof rpcModules\n`;
}

/** Browser-safe descriptor: verb + param-ness + pagination only — no `path`. */
function emitRpcDescriptor(op: OperationNode): string {
  const fields = [
    `method: ${JSON.stringify(op.method)}`,
    `hasPathParams: ${op.path.includes('{') ? 'true' : 'false'}`,
    `isPaginated: ${op.isPaginated ? 'true' : 'false'}`,
  ];
  if (op.deprecated) fields.push('deprecated: true');
  return `{ ${fields.join(', ')} }`;
}

/**
 * Descriptor for one operation. Deterministic key ordering. The `method` is
 * emitted as a bare string literal (NOT `as HttpMethod`) so the enclosing
 * `as const` preserves it — the TanStack integration relies on the literal verb
 * to route each method to queryOptions vs mutationOptions at the type level.
 */
function emitDescriptor(op: OperationNode): string {
  const fields = [
    `method: ${JSON.stringify(op.method)}`,
    `path: ${JSON.stringify(op.path)}`,
    `isPaginated: ${op.isPaginated ? 'true' : 'false'}`,
    `operationId: ${JSON.stringify(op.id)}`,
  ];
  if (op.deprecated) fields.push('deprecated: true');
  return `{ ${fields.join(', ')} }`;
}

/** Resolve a tag to a safe module name, renaming reserved collisions. */
function resolveModuleName(tag: string): EmittedModule {
  const camel = toCamelCase(tag);
  if (RESERVED_MEMBERS.has(camel)) {
    const name = `${camel}Module`;
    return {
      tag,
      name,
      warning: `tag "${tag}" collides with reserved client member "${camel}"; renamed to "${name}".`,
    };
  }
  return { tag, name: camel };
}

/**
 * Derive a method name from an operationId, stripping a redundant leading tag
 * prefix (e.g. tag `invoices` + `invoicesList` -> `list`).
 */
function deriveMethodName(operationId: string, tag: string): string {
  const camelId = toCamelCase(operationId);
  const camelTag = toCamelCase(tag);
  if (camelTag.length > 0) {
    const lower = camelId.toLowerCase();
    const tagLower = camelTag.toLowerCase();
    if (lower.startsWith(tagLower) && camelId.length > camelTag.length) {
      const rest = camelId.slice(camelTag.length);
      const stripped = lowerFirst(rest);
      if (isValidIdentifier(stripped)) return stripped;
    }
  }
  return camelId;
}

/** Convert an arbitrary token to camelCase, splitting on non-alphanumerics. */
function toCamelCase(input: string): string {
  const words = input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return input;
  const first = words[0]!.toLowerCase();
  const rest = words.slice(1).map((w) => upperFirst(w.toLowerCase()));
  const joined = first + rest.join('');
  return isValidIdentifier(joined) ? joined : `_${joined}`;
}

function upperFirst(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0]!.toLowerCase() + s.slice(1);
}

function isValidIdentifier(s: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
}

/** Quote an object key only when it is not a valid bare identifier. */
function quoteKey(key: string): string {
  return isValidIdentifier(key) ? key : JSON.stringify(key);
}

/** Auto-generated file banner. */
function emitBanner(ast: SchemaAST, opts: EmitModulesOptions): string {
  const lines = [
    '/**',
    ' * AUTO-GENERATED by @developerEhsan/api-client. DO NOT EDIT.',
    ' *',
    ` * Source: ${ast.info.title} v${ast.info.version} (OpenAPI ${ast.openapiVersion})`,
  ];
  if (opts.generatedAt) lines.push(` * Generated at: ${opts.generatedAt}`);
  if (opts.sourceHash) lines.push(` * Source hash: ${opts.sourceHash}`);
  lines.push(' */');
  return lines.join('\n');
}
