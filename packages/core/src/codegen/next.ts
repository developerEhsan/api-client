/**
 * Next.js codegen integration (roadmap C3). `withApiClientCodegen` wraps your
 * `next.config` so codegen runs automatically: a one-shot `generate` for a
 * production build, or a background `watchAndGenerate` in dev. Configuration
 * comes from `api-client.config.*` (see {@link loadCodegenConfig}), optionally
 * overridden inline.
 *
 * Next evaluates `next.config` in multiple processes; a per-process guard keeps
 * a single watcher/generate per process (best-effort — Next dedupes the rest).
 */
import { type CodegenConfig, loadCodegenConfig } from './config';
import { generate } from './generate';
import { watchAndGenerate } from './watch';

/** Marks that codegen has already been kicked off in this process. */
const STARTED = Symbol.for('developerehsan.api-client.codegen.next.started');

function isDev(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  // In `next dev` the phase is development; a build sets production.
  return env?.NODE_ENV !== 'production' && env?.NEXT_PHASE !== 'phase-production-build';
}

async function runCodegen(overrides: Partial<CodegenConfig>): Promise<void> {
  let loaded: CodegenConfig | undefined;
  try {
    loaded = (await loadCodegenConfig(process.cwd()))?.config;
  } catch {
    loaded = undefined;
  }
  const config: Partial<CodegenConfig> = { ...loaded, ...overrides };
  if (!config.input || !config.output) return; // nothing configured — no-op
  const full: CodegenConfig = { input: config.input, output: config.output };
  if (config.baseURL) full.baseURL = config.baseURL;
  if (config.headers) full.headers = config.headers;
  if (config.watch) full.watch = config.watch;

  try {
    if (isDev()) {
      watchAndGenerate(full, {
        onError: (e) => console.warn('[@developerehsan/api-client] codegen watch error:', e),
      });
    } else {
      await generate({
        input: full.input,
        output: full.output,
        ...(full.baseURL ? { baseURL: full.baseURL } : {}),
        ...(full.headers ? { headers: full.headers } : {}),
        generatedAt: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.warn('[@developerehsan/api-client] codegen failed:', e);
  }
}

/**
 * Wrap a Next.js config so codegen runs on dev/build. Returns `nextConfig`
 * unchanged (the codegen runs as a side effect at config-load time).
 *
 * @example
 * // next.config.mjs
 * import { withApiClientCodegen } from '@developerehsan/api-client/codegen'
 * export default withApiClientCodegen({ }, { input: './openapi.json', output: './src/generated' })
 */
export function withApiClientCodegen<T extends Record<string, unknown>>(
  nextConfig: T = {} as T,
  overrides: Partial<CodegenConfig> = {},
): T {
  const g = globalThis as unknown as Record<symbol, boolean>;
  if (!g[STARTED]) {
    g[STARTED] = true;
    void runCodegen(overrides);
  }
  return nextConfig;
}
