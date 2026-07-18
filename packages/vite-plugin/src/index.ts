/**
 * `@developerehsan/api-client-vite` — a Vite plugin (roadmap C3) that runs
 * OpenAPI codegen automatically: a one-shot `generate` on build start (so the
 * generated types exist for the build) and a background `watchAndGenerate` while
 * the dev server runs. Because TanStack Start is Vite-based, this plugin covers
 * it too.
 *
 * Configuration comes from `api-client.config.*` (see the core codegen config
 * loader), with optional inline overrides. The plugin is typed structurally
 * (no hard `vite` dependency) so it drops into any Vite ≥4 config.
 */
import {
  type CodegenConfig,
  generate,
  loadCodegenConfig,
  watchAndGenerate,
} from '@developerehsan/api-client/codegen';

/** The minimal subset of a Vite `Plugin` this factory returns (avoids a vite dep). */
export interface VitePluginLike {
  name: string;
  buildStart?: () => void | Promise<void>;
  configureServer?: () => void | Promise<void>;
  buildEnd?: () => void | Promise<void>;
}

/** Options: any subset of {@link CodegenConfig} to override the config file. */
export type ApiClientCodegenOptions = Partial<CodegenConfig>;

/**
 * Create the plugin. Add it to `plugins: [apiClientCodegen()]` in your Vite (or
 * TanStack Start) config.
 *
 * @example
 * // vite.config.ts
 * import { apiClientCodegen } from '@developerehsan/api-client-vite'
 * export default { plugins: [apiClientCodegen({ input: './openapi.json', output: './src/generated' })] }
 */
export function apiClientCodegen(overrides: ApiClientCodegenOptions = {}): VitePluginLike {
  let watcher: { close(): void } | undefined;

  const resolve = async (): Promise<CodegenConfig | undefined> => {
    let loaded: CodegenConfig | undefined;
    try {
      loaded = (await loadCodegenConfig(process.cwd()))?.config;
    } catch {
      loaded = undefined;
    }
    const merged: Partial<CodegenConfig> = { ...loaded, ...overrides };
    if (!merged.input || !merged.output) return undefined;
    return merged as CodegenConfig;
  };

  return {
    name: '@developerehsan/api-client-codegen',
    async buildStart() {
      const config = await resolve();
      if (!config) return;
      await generate({
        input: config.input,
        output: config.output,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        ...(config.headers ? { headers: config.headers } : {}),
        generatedAt: new Date().toISOString(),
      });
    },
    async configureServer() {
      const config = await resolve();
      if (!config) return;
      watcher = watchAndGenerate(config, {
        onError: (e) => console.warn('[@developerehsan/api-client] codegen watch error:', e),
      });
    },
    buildEnd() {
      watcher?.close();
    },
  };
}

export default apiClientCodegen;
