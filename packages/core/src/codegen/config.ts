/**
 * Config-file support for codegen (`api-client.config.{ts,mts,js,mjs,json}`).
 *
 * Lets a project declare its spec source + output once and run `generate`/
 * `watch`/`check` with no flags, and drives the dev/build integrations. The
 * loader resolves the first matching file walking up from a directory.
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ConfigurationError } from '../errors/ConfigurationError';

/** A codegen configuration, typically exported from `api-client.config.ts`. */
export interface CodegenConfig {
  /** Path or http(s) URL to the OpenAPI 3.x JSON document. */
  input: string;
  /** Output directory for generated files. */
  output: string;
  /** Optional base URL recorded for downstream tooling. */
  baseURL?: string;
  /**
   * Headers to send when `input` is a URL (e.g. `{ Authorization: '...' }`).
   * Treated as secret: never logged or written into generated output. Prefer
   * sourcing values from `process.env` in the config file.
   */
  headers?: Record<string, string>;
  /** Watch behavior (remote polling interval, etc.). */
  watch?: {
    /** Poll interval in ms when `input` is a URL. Default 30_000. */
    pollIntervalMs?: number;
  };
}

/**
 * Identity helper for authoring a typed config file:
 *
 * ```ts
 * // api-client.config.ts
 * import { defineCodegenConfig } from '@developerehsan/api-client/codegen'
 * export default defineCodegenConfig({
 *   input: process.env.OPENAPI_URL ?? './openapi.json',
 *   output: './src/generated',
 * })
 * ```
 */
export function defineCodegenConfig(config: CodegenConfig): CodegenConfig {
  return config;
}

const CONFIG_BASENAMES = [
  'api-client.config.ts',
  'api-client.config.mts',
  'api-client.config.mjs',
  'api-client.config.js',
  'api-client.config.json',
];

function assertValidConfig(value: unknown, source: string): asserts value is CodegenConfig {
  if (typeof value !== 'object' || value === null) {
    throw new ConfigurationError(`Codegen config "${source}" must export an object.`);
  }
  const cfg = value as Record<string, unknown>;
  if (typeof cfg.input !== 'string' || cfg.input.length === 0) {
    throw new ConfigurationError(`Codegen config "${source}" is missing a string "input".`);
  }
  if (typeof cfg.output !== 'string' || cfg.output.length === 0) {
    throw new ConfigurationError(`Codegen config "${source}" is missing a string "output".`);
  }
}

/**
 * Load and validate a codegen config from an explicit path.
 *
 * `.json` is read directly. `.mjs`/`.js` are imported. `.ts`/`.mts` require a
 * TS-aware loader (`jiti`) to be resolvable; when it is not, a clear error
 * suggests using a `.mjs`/`.json` config or installing `jiti`. A `default`
 * export is unwrapped.
 */
export async function loadCodegenConfigFile(path: string): Promise<CodegenConfig> {
  let value: unknown;

  if (path.endsWith('.json')) {
    value = JSON.parse(await readFile(path, 'utf8'));
  } else if (path.endsWith('.ts') || path.endsWith('.mts')) {
    value = await importWithJiti(path);
  } else {
    const mod = (await import(pathToFileURL(path).href)) as { default?: unknown };
    value = mod.default ?? mod;
  }

  if (value && typeof value === 'object' && 'default' in (value as Record<string, unknown>)) {
    value = (value as { default: unknown }).default;
  }
  assertValidConfig(value, path);
  return value;
}

/** Import a TS config via `jiti` if available; otherwise raise a helpful error. */
async function importWithJiti(path: string): Promise<unknown> {
  let createJiti: ((base: string, opts?: unknown) => (id: string) => unknown) | undefined;
  try {
    // Optional dependency, only needed for TS config files. The specifier is
    // computed so the type-checker/bundler does not require `jiti` to resolve
    // at build time (it is a soft, runtime-only dependency).
    const spec = 'jiti';
    const mod = (await import(spec)) as {
      createJiti?: typeof createJiti;
      default?: typeof createJiti;
    };
    createJiti = mod.createJiti ?? (mod.default as typeof createJiti);
  } catch {
    throw new ConfigurationError(
      `Loading a TypeScript codegen config ("${path}") requires the optional "jiti" dependency. Install it (pnpm add -D jiti), or use an api-client.config.mjs / .json config instead.`,
    );
  }
  const jiti = createJiti?.(path);
  const loaded = jiti?.(path) as { default?: unknown } | undefined;
  return loaded?.default ?? loaded;
}

/**
 * Find and load the nearest codegen config, searching `startDir` upward to the
 * filesystem root. Returns `undefined` when none is found (caller falls back to
 * CLI flags). An explicit `configPath` bypasses the search.
 */
export async function loadCodegenConfig(
  startDir: string,
  configPath?: string,
): Promise<{ config: CodegenConfig; path: string } | undefined> {
  if (configPath) {
    return { config: await loadCodegenConfigFile(configPath), path: configPath };
  }

  // Resolve lazily to keep this module import-light for consumers that only
  // want the types / defineCodegenConfig.
  const { join, dirname } = await import('node:path');
  const { access } = await import('node:fs/promises');

  let dir = startDir;
  // Walk up until the root; `dirname('/') === '/'` terminates the loop.
  for (;;) {
    for (const name of CONFIG_BASENAMES) {
      const candidate = join(dir, name);
      try {
        await access(candidate);
        return { config: await loadCodegenConfigFile(candidate), path: candidate };
      } catch {
        // not here; try the next basename
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
