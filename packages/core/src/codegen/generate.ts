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
  /** Path or http(s) URL to the input OpenAPI 3.x JSON document. */
  input: string;
  /** Output directory that generated files are written into. */
  output: string;
  /** Optional base URL, recorded for downstream tooling. */
  baseURL?: string;
  /** ISO timestamp stamped into generated banners. Caller-supplied (no clock use here). */
  generatedAt?: string;
  /**
   * Headers to send when `input` is a URL (e.g. an auth token). Treated as
   * secret — never logged or written into generated output.
   */
  headers?: Record<string, string>;
  /**
   * CI mode: generate to memory and compare against the existing output instead
   * of writing. `result.upToDate` reports whether the output is already current.
   * Nothing on disk is modified.
   */
  check?: boolean;
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
  /** Paths (relative to `output`) of the files written (empty in check mode). */
  files: string[];
  /**
   * In `check` mode: whether the on-disk output already matches what would be
   * generated. `undefined` outside check mode.
   */
  upToDate?: boolean;
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

/** True when `input` is an http(s) URL rather than a filesystem path. */
function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

/**
 * Reduce a URL to `origin + pathname` for safe logging. Userinfo
 * (`https://token@host`) and query strings (`?apikey=...`) commonly carry
 * secrets, so they are dropped before any URL reaches an error message or log.
 */
function redactUrl(input: string): string {
  try {
    const u = new URL(input);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '<url>';
  }
}

/** Options for {@link readInput} when the source is an http(s) URL. */
export interface ReadInputOptions {
  /**
   * Headers sent with the spec fetch (e.g. `Authorization`). NEVER logged or
   * echoed into errors — treated as secret.
   */
  headers?: Record<string, string>;
  /** Prior `ETag` for a conditional GET; a matching 304 short-circuits. */
  etag?: string;
  /** Abort signal for the fetch. */
  signal?: AbortSignal;
}

/** Result of {@link readInput}. */
export interface ReadInputResult {
  raw: string;
  doc: unknown;
  /** Response `ETag` when fetched over HTTP (drives conditional polling). */
  etag?: string;
  /** True when a conditional GET returned 304; `raw`/`doc` are then empty. */
  notModified?: boolean;
}

/**
 * Read and parse the input document into a raw string plus its parsed value.
 * Accepts either a filesystem path or an http(s) URL.
 *
 * SECURITY: when fetching a URL, request headers (which may contain secrets)
 * are never logged, and any URL that appears in an error is reduced to
 * origin+path so userinfo/query tokens can't leak (see {@link redactUrl}).
 *
 * @throws {ConfigurationError} If a file is missing or a fetch fails.
 * @throws {SchemaParseError} If the payload is not valid JSON.
 */
async function readInput(input: string, options: ReadInputOptions = {}): Promise<ReadInputResult> {
  let raw: string;

  if (isHttpUrl(input)) {
    const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
    if (options.etag) headers['if-none-match'] = options.etag;
    let response: Response;
    try {
      response = await fetch(input, {
        headers,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      // Do not include headers or the raw URL (may carry secrets) in the message.
      throw new ConfigurationError(`Failed to fetch OpenAPI spec from ${redactUrl(input)}.`, error);
    }
    if (response.status === 304) {
      return {
        raw: '',
        doc: undefined,
        notModified: true,
        ...(options.etag ? { etag: options.etag } : {}),
      };
    }
    if (!response.ok) {
      throw new ConfigurationError(
        `Failed to fetch OpenAPI spec from ${redactUrl(input)} (HTTP ${response.status}).`,
      );
    }
    raw = await response.text();
    const etag = response.headers.get('etag') ?? undefined;
    const doc = parseJson(raw, redactUrl(input));
    return { raw, doc, ...(etag ? { etag } : {}) };
  }

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

  return { raw, doc: parseJson(raw, input) };
}

/** Parse JSON, raising a {@link SchemaParseError} that names `source` on failure. */
function parseJson(raw: string, source: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new SchemaParseError({
      message: `OpenAPI source "${source}" is not valid JSON.`,
      code: 'INVALID_JSON',
      cause: error,
    });
  }
}

/**
 * Deterministic canonical JSON: object keys sorted recursively so semantically
 * equal values hash identically regardless of key order. Used for per-operation
 * drift hashing.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

/** The drift metadata persisted alongside generated output (`api.schema.meta.json`). */
export interface SchemaMeta {
  /** Full-document source hash (mirrors `api.schema.hash`). */
  hash: string;
  /** operationId -> stable per-operation hash, for precise drift detection. */
  operations: Record<string, string>;
}

/** Build the per-operation drift map from a parsed AST. */
function buildOperationHashes(ast: SchemaAST): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, op] of Object.entries(ast.operations)) {
    out[id] = fnv1a(stableStringify(op));
  }
  return out;
}

/**
 * Parse an OpenAPI document from disk without writing anything.
 *
 * @throws {ConfigurationError} If the file is missing.
 * @throws {SchemaParseError} If the JSON or the OpenAPI document is invalid.
 */
export async function validate(input: string, options?: ReadInputOptions): Promise<SchemaAST> {
  const { doc } = await readInput(input, options);
  return parseOpenApi(doc);
}

/** Load the persisted drift metadata, or `undefined` if none (legacy output). */
async function readMeta(output: string): Promise<SchemaMeta | undefined> {
  try {
    const raw = await readFile(join(output, 'api.schema.meta.json'), 'utf8');
    return JSON.parse(raw) as SchemaMeta;
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Compare `input` against the metadata recorded under `output`, producing a real
 * per-operation diff (added / removed / changed operation ids).
 *
 * When only a legacy `api.schema.hash` (no `api.schema.meta.json`) is present,
 * per-operation arrays cannot be computed and are returned empty;
 * {@link SchemaDiff.hashChanged} is always authoritative.
 */
export async function diff(
  input: string,
  output: string,
  options?: ReadInputOptions,
): Promise<SchemaDiff> {
  const { raw, doc } = await readInput(input, options);
  const nextHash = fnv1a(raw);
  const nextOps = buildOperationHashes(parseOpenApi(doc));

  let previousHash: string | undefined;
  try {
    previousHash = (await readFile(join(output, 'api.schema.hash'), 'utf8')).trim();
  } catch (error) {
    if (!(isErrnoException(error) && error.code === 'ENOENT')) throw error;
    previousHash = undefined;
  }

  const meta = await readMeta(output);
  const addedOperations: string[] = [];
  const removedOperations: string[] = [];
  const changedOperations: { id: string; reason: string }[] = [];

  if (meta) {
    const prevOps = meta.operations;
    for (const id of Object.keys(nextOps)) {
      if (!(id in prevOps)) addedOperations.push(id);
      else if (prevOps[id] !== nextOps[id])
        changedOperations.push({ id, reason: 'operation signature changed' });
    }
    for (const id of Object.keys(prevOps)) {
      if (!(id in nextOps)) removedOperations.push(id);
    }
    addedOperations.sort();
    removedOperations.sort();
    changedOperations.sort((a, b) => a.id.localeCompare(b.id));
  }

  return {
    addedOperations,
    removedOperations,
    changedOperations,
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
  const { input, output, generatedAt, check } = options;

  const { raw, doc } = await readInput(input, options.headers ? { headers: options.headers } : {});
  const ast = parseOpenApi(doc);
  const sourceHash = fnv1a(raw);

  const banner = { generatedAt, sourceHash };
  const typesSource = emitTypes(ast, banner);
  const modulesSource = emitModules(ast, banner);
  const rpcModulesSource = emitRpcModules(ast, banner);
  const meta: SchemaMeta = { hash: sourceHash, operations: buildOperationHashes(ast) };
  const metaSource = `${JSON.stringify(meta, null, 2)}\n`;

  const summary = {
    operations: Object.keys(ast.operations).length,
    components: Object.keys(ast.components).length,
    tags: Object.keys(ast.tags).length,
    sourceHash,
  };

  // CI mode: compare the would-be output against disk without writing anything.
  // The source hash is a sufficient, cheap up-to-date signal.
  if (check) {
    let previousHash: string | undefined;
    try {
      previousHash = (await readFile(join(output, 'api.schema.hash'), 'utf8')).trim();
    } catch (error) {
      if (!(isErrnoException(error) && error.code === 'ENOENT')) throw error;
    }
    return { ...summary, files: [], upToDate: previousHash === sourceHash };
  }

  await mkdir(output, { recursive: true });
  await mkdir(join(output, 'overrides'), { recursive: true });

  await Promise.all([
    writeFile(join(output, 'api.types.ts'), typesSource, 'utf8'),
    writeFile(join(output, 'api.modules.ts'), modulesSource, 'utf8'),
    writeFile(join(output, 'api.rpc.ts'), rpcModulesSource, 'utf8'),
    writeFile(join(output, 'api.schema.hash'), `${sourceHash}\n`, 'utf8'),
    writeFile(join(output, 'api.schema.meta.json'), metaSource, 'utf8'),
    writeFile(join(output, 'overrides', '.gitkeep'), '', 'utf8'),
  ]);

  return {
    ...summary,
    files: [
      'api.types.ts',
      'api.modules.ts',
      'api.rpc.ts',
      'api.schema.hash',
      'api.schema.meta.json',
      'overrides/.gitkeep',
    ],
  };
}
