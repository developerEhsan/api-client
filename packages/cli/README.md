# @developerehsan/api-client-cli

[![npm version](https://img.shields.io/npm/v/@developerehsan/api-client-cli.svg)](https://www.npmjs.com/package/@developerehsan/api-client-cli)
[![npm downloads](https://img.shields.io/npm/dm/@developerehsan/api-client-cli.svg)](https://www.npmjs.com/package/@developerehsan/api-client-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/developerEhsan/api-client/blob/master/LICENSE)

> Command-line **OpenAPI codegen** for
> [`@developerehsan/api-client`](https://www.npmjs.com/package/@developerehsan/api-client) —
> generate fully-typed TypeScript types and module descriptors from an OpenAPI 3.x
> spec, validate specs in CI, and diff a spec against previously generated output.

This is a thin `bin` wrapper over the `@developerehsan/api-client/codegen` entry,
exposed as the `developerEhsan-api-client` command.

## Usage

No install needed — run it with `npx`:

```bash
# Generate TypeScript types + module descriptors (local file OR https URL)
npx @developerehsan/api-client-cli generate \
  --input ./openapi.json \
  --output ./src/generated \
  --base-url https://api.example.com

# Re-generate on change (local watch, or ETag/hash-aware polling for a URL)
npx @developerehsan/api-client-cli generate --watch

# CI: fail (non-zero exit) if the generated output is stale vs the spec
npx @developerehsan/api-client-cli generate --check

# Validate a spec (CI-friendly; no file writes)
npx @developerehsan/api-client-cli validate --input ./openapi.json

# Show a per-operation diff since the last generation (+added / -removed / ~changed)
npx @developerehsan/api-client-cli diff --input ./openapi.json --output ./src/generated
```

### Zero-config via `api-client.config.*`

Declare `input`/`output`/`baseURL` once and drop the flags. The CLI resolves the
nearest `api-client.config.{ts,mts,mjs,js,json}` (or `--config <path>`); explicit
flags override it.

```ts
// api-client.config.ts
import { defineCodegenConfig } from '@developerehsan/api-client/codegen'
export default defineCodegenConfig({ input: './openapi.json', output: './src/generated' })
```

```bash
npx @developerehsan/api-client-cli generate          # reads the config
npx @developerehsan/api-client-cli generate --check  # CI staleness gate
```

> Prefer auto-generation as part of your build? Use the
> [`@developerehsan/api-client-vite`](https://www.npmjs.com/package/@developerehsan/api-client-vite)
> plugin, or `withApiClientCodegen()` from `@developerehsan/api-client/codegen` for Next.js.

Or install it as a dev dependency:

```bash
npm install --save-dev @developerehsan/api-client-cli
```

## Generated files

```
src/generated/
├── api.types.ts      # interfaces + an OperationsMap (DO NOT EDIT)
├── api.modules.ts    # `generatedModules` descriptor map (DO NOT EDIT)
├── api.rpc.ts        # paths-stripped descriptor for the SSR RPC bridge
├── api.schema.hash   # spec hash for drift detection
└── overrides/        # your custom type augmentations (safe to edit)
```

The parser handles `$ref`, `allOf` / `oneOf` / `anyOf`, `nullable`, enums, and
circular references. Use the generated **types** for your method signatures and
the generated **`generatedModules`** descriptor with the TanStack Query
integration.

## Documentation

📖 Full codegen documentation and the runtime library guide live in the
**[project README on GitHub](https://github.com/developerEhsan/api-client#readme)**.
See also the dedicated
**[codegen docs page](https://github.com/developerEhsan/api-client/blob/master/docs/codegen.md)**.

## License

[MIT](https://github.com/developerEhsan/api-client/blob/master/LICENSE) © EHSAN
