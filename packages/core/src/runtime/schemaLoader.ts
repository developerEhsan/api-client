import { parseOpenApi } from '../codegen/parser';
import { SchemaError } from '../errors/SchemaError';
/**
 * Runtime OpenAPI schema loader (dev mode). Fetches the spec from a URL, parses
 * it to a {@link SchemaAST}, and caches it. On a failed refresh it falls back to
 * the last known-good schema (spec S6). Optional polling re-fetches on an
 * interval and reports drift between successive loads.
 */
import type { SchemaAST } from '../types/openapi.types';
import { stableHash } from '../utilities/hash';
import { type DriftPolicy, diffSchemas, handleDrift } from './driftDetector';
import type { SchemaCache } from './schemaCache';

export interface SchemaLoaderDeps {
  cache: SchemaCache;
  /** Fetches and JSON-parses the schema document. Defaults to global fetch. */
  fetchJson?: (url: string) => Promise<unknown>;
}

export interface SchemaLoader {
  /** Fetch + parse + cache. On failure returns the last-good schema, else throws. */
  load(url: string): Promise<SchemaAST>;
  /** Poll `url` every `intervalMs`, applying `drift` policy between loads. Returns a stop fn. */
  startPolling(url: string, intervalMs: number, drift?: DriftPolicy): () => void;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  if (typeof fetch !== 'function') {
    throw new SchemaError({ message: 'No global fetch available to load the runtime schema.' });
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new SchemaError({
      message: `Failed to fetch OpenAPI schema from ${url}: HTTP ${response.status}`,
      status: response.status,
    });
  }
  return response.json();
}

export function createSchemaLoader(deps: SchemaLoaderDeps): SchemaLoader {
  const { cache } = deps;
  const fetchJson = deps.fetchJson ?? defaultFetchJson;

  async function load(url: string): Promise<SchemaAST> {
    try {
      const doc = await fetchJson(url);
      const ast = parseOpenApi(doc);
      cache.set(ast, stableHash(doc));
      return ast;
    } catch (cause) {
      // S6: fall back to the last successfully loaded schema, if any.
      const lastGood = cache.getLastGood();
      if (lastGood) {
        console.warn(
          `[@developerehsan/api-client] Runtime schema fetch failed; using last known-good schema. (${cause instanceof Error ? cause.message : String(cause)})`,
        );
        return lastGood;
      }
      if (cause instanceof SchemaError) throw cause;
      throw new SchemaError({
        message: `Failed to load runtime schema from ${url}.`,
        cause,
      });
    }
  }

  function startPolling(url: string, intervalMs: number, drift?: DriftPolicy): () => void {
    const timer = setInterval(() => {
      const previous = cache.get();
      void load(url)
        .then((next) => {
          if (previous && drift) handleDrift(diffSchemas(previous, next), drift);
        })
        .catch(() => undefined);
    }, intervalMs);
    // Don't keep the Node event loop alive purely for schema polling.
    if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref();
    return () => clearInterval(timer);
  }

  return { load, startPolling };
}
