# @developerehsan/api-client-vite

A [Vite](https://vite.dev) plugin that runs [`@developerehsan/api-client`](https://www.npmjs.com/package/@developerehsan/api-client) OpenAPI **codegen automatically** — a one-shot generate on `vite build`, and a background watcher during `vite dev` that regenerates your typed client whenever the spec changes. Because [TanStack Start](https://tanstack.com/start) is Vite-based, this covers it too.

## Install

```bash
pnpm add -D @developerehsan/api-client-vite
# peer: vite >= 4 (optional — the plugin is structurally typed)
```

## Usage

Point it at your OpenAPI spec (a local path or an `http(s)` URL) and an output directory:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { apiClientCodegen } from '@developerehsan/api-client-vite'

export default defineConfig({
  plugins: [
    apiClientCodegen({
      input: './src/lib/api/openapi.json', // path or https URL
      output: './src/lib/api/types/generated',
      baseURL: 'https://api.example.com',
    }),
  ],
})
```

- **`vite build`** → runs `generate` once so the generated types exist for the build.
- **`vite dev`** → starts a watcher; editing `openapi.json` (or polling a remote URL) regenerates the client on the fly.

### Zero-config

If you have an `api-client.config.{ts,mjs,js,json}` (via `defineCodegenConfig`), call `apiClientCodegen()` with no arguments and it reads `input`/`output`/`baseURL` from there. Inline options override the config file.

```ts
apiClientCodegen() // reads api-client.config.*
```

### Remote specs

When `input` is a URL, the watcher does conditional (ETag/hash-aware) polling so an unchanged spec never triggers a regenerate. Any `headers` you set (e.g. an auth token) are sent with the fetch and are **never** logged or written into generated output.

## What it generates

The same artifacts as the CLI: `api.types.ts` (the `OperationsMap` type), `api.modules.ts` (the `generatedModules` descriptor), `api.rpc.ts` (paths-stripped descriptor for the SSR bridge), `api.schema.hash`, and `api.schema.meta.json`.

See the [main package README](https://github.com/developerEhsan/api-client#readme) for wiring the generated output into a client, and the `examples/react-vite` app for a working setup.

## License

MIT
