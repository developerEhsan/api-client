# Multiple environments & base URLs

[← Docs index](./README.md)

```ts
createClient({
  environments: {
    dev:     'http://localhost:3000',
    staging: 'https://staging.example.com',
    prod:    'https://api.example.com',
  },
  activeEnvironment: 'dev',   // picks the base URL; must exist in the map
  openapi: { mode: 'runtime' },
})

// Switch at runtime — this also clears the cache:
api.setEnvironment('staging')
```

- An unknown `activeEnvironment` throws a `ConfigurationError` at `createClient`
  time (fail fast).
- A module can target a different host with `config.baseURL` — see
  [modules & methods](./modules-and-methods.md#module-level-configuration).
- Switching environments **clears the cache**, so stale data from one
  environment never leaks into another.

**See it live:** the Feature Lab "Environments" button calls
`api.setEnvironment(...)` to switch the active base URL at runtime and shows the
resolved config change —
[`examples/react-vite/src/features/FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx).
</content>
