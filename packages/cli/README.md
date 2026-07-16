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
# Generate TypeScript types + module descriptors
npx @developerehsan/api-client-cli generate \
  --input ./openapi.json \
  --output ./src/generated \
  --base-url https://api.example.com

# Re-generate on change
npx @developerehsan/api-client-cli generate --watch

# Validate a spec (CI-friendly; no file writes)
npx @developerehsan/api-client-cli validate --input ./openapi.json

# Show what changed since the last generation
npx @developerehsan/api-client-cli diff --input ./openapi.json --output ./src/generated
```

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

## License

[MIT](https://github.com/developerEhsan/api-client/blob/master/LICENSE) © EHSAN
