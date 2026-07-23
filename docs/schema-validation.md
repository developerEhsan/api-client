# Runtime schema validation & drift detection

[← Docs index](./README.md)

In `runtime` mode the client can fetch your OpenAPI spec and validate responses
against it — great for catching backend drift in development.

```ts
createClient({
  openapi: {
    mode: 'runtime',
    runtimeURL: 'https://api.example.com/openapi.json',
    validation: {
      enabled: true,
      mode: 'loose',   // 'loose' warns; 'strict' throws a SchemaError
      onDriftDetected: (diff) => console.warn('schema drift', diff),
    },
  },
  dev: { schemaRefreshInterval: 30_000 },   // re-fetch + diff periodically
})

api.getSchema()   // the loaded SchemaAST (or undefined before it loads)
```

- Validation is **dependency-free** (no `zod` required); it checks bodies
  structurally, including enums, unions, `$ref`s, and `additionalProperties`.
- If a refresh fails, the last known-good schema is kept.
- Drift detection compares operation signatures **and** body/response types.

**See it live:** both examples run with `openapi: { mode: 'runtime', validation:
{ enabled: true, mode: 'loose' } }`, so response validation runs against the
loaded schema and warns (rather than throws) on mismatch —
[`examples/react-vite/src/lib/api/api.config.ts`](../examples/react-vite/src/lib/api/api.config.ts).

## Loose vs. strict

| Mode | On mismatch |
| --- | --- |
| `loose` | Logs a warning; the response is still returned. Good for dev/prod. |
| `strict` | Throws a `SchemaError`. Good for tests/CI to catch drift hard. |

## Auto-modules from the runtime schema

With `modules: { auto: true }`, module methods are derived at runtime from the
fetched OpenAPI document (resolved lazily as the schema loads) — you get callable
methods for every tagged operation without hand-writing them. The examples use
`auto: true` alongside a few custom overrides.

## Standalone validation utilities

```ts
import { validateResponseBody, diffSchemas, hasDrift } from '@developerehsan/api-client'
```

See the [API reference](./api-reference.md#runtime-schema).
</content>
