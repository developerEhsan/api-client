/**
 * @developerehsan/api-client codegen CLI.
 *
 * Commands: `generate` (emit the typed client), `validate` (parse + report
 * counts), and `diff` (per-operation change report vs the last generation).
 *
 * Configuration resolves from an `api-client.config.{ts,mts,mjs,js,json}` file
 * (nearest, searching up from the CWD, or `--config <path>`); explicit flags
 * override the config file.
 *
 * @example
 * # zero-config: reads api-client.config.ts { input, output }
 * developerEhsan-api-client generate
 *
 * @example
 * # explicit flags, watch, and remote spec URL
 * developerEhsan-api-client generate --input https://api.example.com/openapi.json \
 *   --output ./src/generated --watch
 *
 * @example
 * # CI: fail if generated output is stale vs the spec (writes nothing)
 * developerEhsan-api-client generate --check
 */
import {
  type CodegenConfig,
  diff,
  generate,
  loadCodegenConfig,
  validate,
  watchAndGenerate,
} from '@developerehsan/api-client/codegen';

interface Args {
  _: string[];
  input?: string;
  output?: string;
  'base-url'?: string;
  config?: string;
  watch?: boolean;
  check?: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { _: [] };
  const flags = new Set(['watch', 'check']);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (flags.has(key)) {
        (args as unknown as Record<string, unknown>)[key] = true;
      } else if (next !== undefined && !next.startsWith('--')) {
        (args as unknown as Record<string, unknown>)[key] = next;
        i++;
      } else {
        (args as unknown as Record<string, unknown>)[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function fail(message: string): never {
  process.stderr.write(`\n\x1b[31m✖ ${message}\x1b[0m\n\n`);
  process.exit(1);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Merge config-file values with flags (flags win). Always requires `input`;
 * `output` is required unless `requireOutput` is false (e.g. for `validate`,
 * which only reads the spec).
 */
async function resolveConfig(args: Args, requireOutput = true): Promise<CodegenConfig> {
  const loaded = await loadCodegenConfig(process.cwd(), args.config);
  const fromFile = loaded?.config;
  const input = args.input ?? fromFile?.input;
  const output = args.output ?? fromFile?.output ?? '';
  if (!input) fail('No "input" provided (pass --input or set it in api-client.config).');
  if (requireOutput && !output) {
    fail('No "output" provided (pass --output or set it in api-client.config).');
  }
  const baseURL = args['base-url'] ?? fromFile?.baseURL;
  return {
    input,
    output,
    ...(baseURL ? { baseURL } : {}),
    ...(fromFile?.headers ? { headers: fromFile.headers } : {}),
    ...(fromFile?.watch ? { watch: fromFile.watch } : {}),
  };
}

async function runGenerate(config: CodegenConfig): Promise<void> {
  const result = await generate({
    input: config.input,
    output: config.output,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.headers ? { headers: config.headers } : {}),
    generatedAt: nowIso(),
  });
  process.stdout.write(
    `\x1b[32m✔\x1b[0m Generated ${config.output} ` +
      `(${result.operations} operations, ${result.components} schemas, ${result.tags} modules)\n`,
  );
}

function printDiff(d: {
  hashChanged: boolean;
  addedOperations: string[];
  removedOperations: string[];
  changedOperations: { id: string; reason: string }[];
}): void {
  if (!d.hashChanged) {
    process.stdout.write('\x1b[32m✔\x1b[0m No changes since last generation.\n');
    return;
  }
  process.stdout.write(
    `\x1b[33m±\x1b[0m Schema changed: +${d.addedOperations.length} -${d.removedOperations.length} ~${d.changedOperations.length} operations\n`,
  );
  for (const id of d.addedOperations) process.stdout.write(`  \x1b[32m+\x1b[0m ${id}\n`);
  for (const id of d.removedOperations) process.stdout.write(`  \x1b[31m-\x1b[0m ${id}\n`);
  for (const c of d.changedOperations) process.stdout.write(`  \x1b[33m~\x1b[0m ${c.id}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  try {
    switch (command) {
      case 'generate': {
        const config = await resolveConfig(args);
        if (args.check) {
          const result = await generate({
            input: config.input,
            output: config.output,
            ...(config.headers ? { headers: config.headers } : {}),
            check: true,
          });
          if (result.upToDate) {
            process.stdout.write('\x1b[32m✔\x1b[0m Generated output is up to date.\n');
          } else {
            fail('Generated output is stale. Run `generate` and commit the result.');
          }
          break;
        }
        await runGenerate(config);
        if (args.watch) {
          process.stdout.write(`\x1b[36m▸\x1b[0m Watching ${config.input} for changes…\n`);
          watchAndGenerate(config, {
            onChange: (d) => printDiff(d),
            onError: (error) =>
              process.stderr.write(
                `Regeneration failed: ${error instanceof Error ? error.message : String(error)}\n`,
              ),
          });
          // Keep the process alive while watching.
          await new Promise(() => {});
        }
        break;
      }
      case 'validate': {
        const config = await resolveConfig(args, false);
        const ast = await validate(config.input, config.headers ? { headers: config.headers } : {});
        const counts =
          `${Object.keys(ast.operations).length} operations, ` +
          `${Object.keys(ast.components).length} schemas, ` +
          `${Object.keys(ast.tags).length} modules`;
        process.stdout.write(`\x1b[32m✔\x1b[0m Valid OpenAPI ${ast.openapiVersion} (${counts})\n`);
        break;
      }
      case 'diff': {
        const config = await resolveConfig(args);
        const result = await diff(
          config.input,
          config.output,
          config.headers ? { headers: config.headers } : {},
        );
        printDiff(result);
        break;
      }
      default:
        fail(`Unknown command "${command ?? ''}". Expected one of: generate, validate, diff.`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
