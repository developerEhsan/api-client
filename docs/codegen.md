# Code generation (CLI + Vite + Next.js)

[← Docs index](./README.md)

Generate TypeScript types and a module descriptor map from an OpenAPI 3.x spec.
The spec is a **build-time input** — it is never bundled into the shipped client.

## CLI

```bash
# Generate types + descriptors (local file OR https URL)
npx @developerehsan/api-client generate \
  --input ./openapi.json \
  --output ./src/generated \
  --base-url https://api.example.com

# Re-generate on change (local watch, or ETag/hash-aware polling for a URL)
npx @developerehsan/api-client generate --watch

# CI: fail (non-zero exit) if generated output is stale vs the spec
npx @developerehsan/api-client generate --check

# Validate a spec (CI-friendly; no file writes)
npx @developerehsan/api-client validate --input ./openapi.json

# Show a per-operation diff since the last generation
npx @developerehsan/api-client diff --input ./openapi.json --output ./src/generated
```

### Zero-config via `api-client.config.*`

```ts
// api-client.config.ts
import { defineCodegenConfig } from '@developerehsan/api-client/codegen'
export default defineCodegenConfig({ input: './openapi.json', output: './src/generated' })
```

```bash
npx @developerehsan/api-client generate          # reads the config
npx @developerehsan/api-client generate --check  # CI staleness gate
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

The parser handles `$ref`, `allOf`/`oneOf`/`anyOf`, `nullable`, enums, and
circular references.

**See it live:** the example's generated output is committed at
[`examples/react-vite/src/lib/api/types/generated/`](../examples/react-vite/src/lib/api/types/generated),
and wired into a client in
[`api.config.ts`](../examples/react-vite/src/lib/api/api.config.ts) via
`createTypedClient<OperationsMap>()(config, generatedModules)`.

## How the generated pieces connect

| File | What it is | Used for |
| --- | --- | --- |
| `api.types.ts` | `OperationsMap` — a **type** describing every operation's params/query/body/response | compile-time safety |
| `api.modules.ts` | `generatedModules` — a **value** mapping method → `{ method, path, operationId }` | runtime dispatch |
| `api.rpc.ts` | `rpcModules` — descriptor with verbs + `hasPathParams` but **no paths** | the [SSR RPC bridge](./ssr-rpc-bridge.md) |

## Vite plugin (also covers TanStack Start)

```ts
// vite.config.ts
import { apiClientCodegen } from '@developerehsan/api-client-vite'

export default defineConfig({
  plugins: [
    apiClientCodegen({
      input: './src/lib/api/openapi.json',
      output: './src/lib/api/types/generated',
      baseURL: 'https://api.example.com',
    }),
  ],
})
```

- `vite build` → runs `generate` once.
- `vite dev` → background watcher regenerates on spec change.

## Next.js integration

```ts
// next.config.ts
import { withApiClientCodegen } from '@developerehsan/api-client/codegen'
export default withApiClientCodegen({ /* nextConfig */ }, { input, output })
```

## Codegen: React Query hooks emission

`emitReactQueryHooks` can emit typed `useXxx` hooks alongside the option
factories — see the [API reference](./api-reference.md).

## Runtime validation from the same spec

In `runtime` mode the client can fetch the spec and validate responses against
it — see [schema validation & drift detection](./schema-validation.md).
</content>
