/**
 * Codegen orchestrator — the entry point the CLI calls.
 *
 * Reads an OpenAPI JSON document, parses it into a {@link SchemaAST}, emits the
 * generated TypeScript (`api.types.ts`, `api.modules.ts`), records a stable
 * source hash, and scaffolds the overrides directory.
 *
 * Fully deterministic for a given input + `generatedAt`: no clock access and no
 * random hashing here (the FNV-1a hash below is purely a function of the raw
 * input bytes).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ConfigurationError } from '../errors/ConfigurationError';
import { SchemaParseError } from '../errors/SchemaError';
import type { SchemaAST, SchemaDiff } from '../types/openapi.types';
import { emitModules, emitRpcModules } from './moduleEmitter';
import { parseOpenApi } from './parser';
import { emitTypes } from './typeEmitter';

/** Options accepted by {@link generate}. */
export interface GenerateOptions {
  /** Path to the input OpenAPI 3.x JSON document. */
  input: string;
  /** Output directory that generated files are written into. */
  output: string;
  /** Optional base URL, recorded for downstream tooling. */
  baseURL?: string;
  /** ISO timestamp stamped into generated banners. Caller-supplied (no clock use here). */
  generatedAt?: string;
}

/** Summary returned by {@link generate}. */
export interface GenerateResult {
  /** Number of operations discovered. */
  operations: number;
  /** Number of component schemas discovered. */
  components: number;
  /** Number of tags (module groups) discovered. */
  tags: number;
  /** The computed stable source hash. */
  sourceHash: string;
  /** Absolute-ish paths (relative to `output`) of the files written. */
  files: string[];
}

/**
 * Stable FNV-1a (32-bit) hash of a string, rendered as 8 lowercase hex chars.
 * Deterministic and dependency-free — never uses crypto randomness.
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in integer range.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}

/**
 * Read and parse the input document into a raw string plus its parsed value.
 *
 * @throws {ConfigurationError} If the input file does not exist (spec S1).
 * @throws {SchemaParseError} If the file is not valid JSON.
 */
async function readInput(input: string): Promise<{ raw: string; doc: unknown }> {
  let raw: string;
  try {
    raw = await readFile(input, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      throw new ConfigurationError(
        `OpenAPI input file not found: "${input}". Check the path passed to the codegen (relative paths resolve from the current working directory).`,
        error,
      );
    }
    throw new ConfigurationError(`Failed to read OpenAPI input file "${input}".`, error);
  }

  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (error) {
    throw new SchemaParseError({
      message: `OpenAPI input file "${input}" is not valid JSON.`,
      code: 'INVALID_JSON',
      cause: error,
    });
  }

  return { raw, doc };
}

/**
 * Parse an OpenAPI document from disk without writing anything.
 *
 * @throws {ConfigurationError} If the file is missing.
 * @throws {SchemaParseError} If the JSON or the OpenAPI document is invalid.
 */
export async function validate(input: string): Promise<SchemaAST> {
  const { doc } = await readInput(input);
  return parseOpenApi(doc);
}

/**
 * Compare the source hash of `input` against the hash recorded under `output`.
 *
 * Operation-level diffing requires the previous AST (which is not persisted), so
 * only {@link SchemaDiff.hashChanged} is authoritative; the operation arrays are
 * returned empty.
 */
export async function diff(input: string, output: string): Promise<SchemaDiff> {
  const { raw } = await readInput(input);
  const nextHash = fnv1a(raw);

  let previousHash: string | undefined;
  try {
    previousHash = (await readFile(join(output, 'api.schema.hash'), 'utf8')).trim();
  } catch (error) {
    if (!(isErrnoException(error) && error.code === 'ENOENT')) throw error;
    previousHash = undefined;
  }

  return {
    addedOperations: [],
    removedOperations: [],
    changedOperations: [],
    hashChanged: previousHash !== nextHash,
  };
}

/**
 * Generate the full client artifacts from an OpenAPI document.
 *
 * Writes `api.types.ts`, `api.modules.ts`, `api.schema.hash`, and ensures an
 * `overrides/.gitkeep` exists, all under `options.output` (created if missing).
 *
 * @throws {ConfigurationError} If the input file is missing.
 * @throws {SchemaParseError} If the input is not valid JSON or OpenAPI 3.x.
 */
export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const { input, output, generatedAt } = options;

  const { raw, doc } = await readInput(input);
  const ast = parseOpenApi(doc);
  const sourceHash = fnv1a(raw);

  const banner = { generatedAt, sourceHash };
  const typesSource = emitTypes(ast, banner);
  const modulesSource = emitModules(ast, banner);
  const rpcModulesSource = emitRpcModules(ast, banner);

  await mkdir(output, { recursive: true });
  await mkdir(join(output, 'overrides'), { recursive: true });

  await Promise.all([
    writeFile(join(output, 'api.types.ts'), typesSource, 'utf8'),
    writeFile(join(output, 'api.modules.ts'), modulesSource, 'utf8'),
    writeFile(join(output, 'api.rpc.ts'), rpcModulesSource, 'utf8'),
    writeFile(join(output, 'api.schema.hash'), `${sourceHash}\n`, 'utf8'),
    writeFile(join(output, 'overrides', '.gitkeep'), '', 'utf8'),
  ]);

  return {
    operations: Object.keys(ast.operations).length,
    components: Object.keys(ast.components).length,
    tags: Object.keys(ast.tags).length,
    sourceHash,
    files: [
      'api.types.ts',
      'api.modules.ts',
      'api.rpc.ts',
      'api.schema.hash',
      'overrides/.gitkeep',
    ],
  };
}
