/**
 * In-memory cache for the runtime-fetched OpenAPI schema (dev mode). Retains
 * both the current schema and the last successfully-loaded one, so a failed
 * refresh can fall back to a known-good schema (spec S6).
 */
import type { SchemaAST } from '../types/openapi.types';

export interface SchemaCache {
  /** The most recently loaded schema, or undefined before the first load. */
  get(): SchemaAST | undefined;
  /** The last schema that loaded successfully (survives a failed refresh). */
  getLastGood(): SchemaAST | undefined;
  /** Hash of the current schema, for drift comparison. */
  hash(): string | undefined;
  /** Epoch ms of the last successful load. */
  fetchedAt(): number | undefined;
  set(ast: SchemaAST, hash: string): void;
  clear(): void;
}

export function createSchemaCache(): SchemaCache {
  let current: SchemaAST | undefined;
  let lastGood: SchemaAST | undefined;
  let currentHash: string | undefined;
  let loadedAt: number | undefined;

  return {
    get: () => current,
    getLastGood: () => lastGood,
    hash: () => currentHash,
    fetchedAt: () => loadedAt,
    set(ast, hash) {
      current = ast;
      lastGood = ast;
      currentHash = hash;
      loadedAt = Date.now();
    },
    clear() {
      current = undefined;
      lastGood = undefined;
      currentHash = undefined;
      loadedAt = undefined;
    },
  };
}
