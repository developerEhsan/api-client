/**
 * @developerEhsan/api-client codegen CLI.
 *
 *   developerEhsan-api-client generate --input ./openapi.json --output ./src/generated [--base-url URL] [--watch]
 *   developerEhsan-api-client validate --input ./openapi.json
 *   developerEhsan-api-client diff --input ./openapi.json --output ./src/generated
 */
import { watch } from "node:fs";
import { generate, validate, diff } from "@developerEhsan/api-client/codegen";

interface Args {
  _: string[];
  input?: string;
  output?: string;
  "base-url"?: string;
  watch?: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (key === "watch") {
        args.watch = true;
      } else if (next !== undefined && !next.startsWith("--")) {
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
  process.stderr.write(`\n[31m✖ ${message}[0m\n\n`);
  process.exit(1);
}

function nowIso(): string {
  return new Date().toISOString();
}

async function runGenerate(args: Args): Promise<void> {
  const input = args.input ?? "./openapi.json";
  const output = args.output ?? "./src/generated";
  const result = await generate({
    input,
    output,
    baseURL: args["base-url"],
    generatedAt: nowIso(),
  });
  process.stdout.write(
    `[32m✔[0m Generated ${output} ` +
      `(${result.operations} operations, ${result.components} schemas, ${result.tags} modules)\n`,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const command = args._[0];

  try {
    switch (command) {
      case "generate": {
        await runGenerate(args);
        if (args.watch) {
          const input = args.input ?? "./openapi.json";
          process.stdout.write(`[36m▸[0m Watching ${input} for changes…\n`);
          let pending = false;
          watch(input, () => {
            if (pending) return;
            pending = true;
            setTimeout(() => {
              pending = false;
              void runGenerate(args).catch((error: unknown) => {
                process.stderr.write(`Regeneration failed: ${String(error)}\n`);
              });
            }, 100);
          });
        }
        break;
      }
      case "validate": {
        const input = args.input ?? "./openapi.json";
        const ast = await validate(input);
        const counts =
          `${Object.keys(ast.operations).length} operations, ` +
          `${Object.keys(ast.components).length} schemas, ` +
          `${Object.keys(ast.tags).length} modules`;
        process.stdout.write(
          `[32m✔[0m Valid OpenAPI ` + `${ast.openapiVersion} (${counts})\n`,
        );
        break;
      }
      case "diff": {
        const input = args.input ?? "./openapi.json";
        const output = args.output ?? "./src/generated";
        const result = await diff(input, output);
        if (!result.hashChanged) {
          process.stdout.write(
            "[32m✔[0m No changes since last generation.\n",
          );
        } else {
          process.stdout.write(
            `[33m±[0m Schema changed: ` +
              `+${result.addedOperations.length} -${result.removedOperations.length} ` +
              `~${result.changedOperations.length} operations\n`,
          );
        }
        break;
      }
      default:
        fail(
          `Unknown command "${command ?? ""}". ` +
            `Expected one of: generate, validate, diff.`,
        );
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

void main();
