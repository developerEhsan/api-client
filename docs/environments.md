# Multiple environments & base URLs

[← Docs index](./README.md)

An app typically talks to different hosts across dev/staging/prod, and the
same client code may run in different JS runtimes (browser, Node, edge) that
support different adapters. `environments` handles the first; runtime
detection (automatic, no config) handles the second.

## Configuring named environments

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
- `setEnvironment(name)` throws a `ConfigurationError` if `name` isn't a key in
  `environments` (`factory/createClient.ts`'s `setEnvironment`), and on success
  it clears **the entire cache** (`cacheStore.clear()`) so stale data from one
  environment never leaks into another.

## Runtime detection: `DetectedEnvironment` / `PlatformCapabilities`

Separately from the `environments` map, the client detects *what JS runtime
it's executing in* (`packages/core/src/environment/detect.ts`,
`detectEnvironment()`) and uses that to pick an HTTP adapter and decide
whether tenant-context propagation via `AsyncLocalStorage` is available. The
shapes, verified against `packages/core/src/types/environment.types.ts`:

```ts
type Environment = 'browser' | 'node' | 'edge' | 'nextjs-server' | 'nextjs-client';

interface PlatformCapabilities {
  supportsAxios: boolean;             // false on edge runtimes
  supportsAsyncLocalStorage: boolean; // Node-like server runtimes only
  hasDom: boolean;                    // window + document present
  hasFetch: boolean;                  // global fetch available
  hasVisibilityApi: boolean;          // document present (visibilitychange)
}

interface DetectedEnvironment {
  environment: Environment;
  capabilities: PlatformCapabilities;
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `environment` | `Environment` | Which of the five runtimes was detected |
| `capabilities.supportsAxios` | `boolean` | Whether the axios adapter can be used |
| `capabilities.supportsAsyncLocalStorage` | `boolean` | Whether Node's `AsyncLocalStorage` is usable |
| `capabilities.hasDom` | `boolean` | Whether `window`/`document` are present |
| `capabilities.hasFetch` | `boolean` | Whether global `fetch` exists |
| `capabilities.hasVisibilityApi` | `boolean` | Whether `visibilitychange` events are available |

Detection order (from `detectEnvironment`'s own doc comment): **edge → browser
(DOM present) → node → nextjs-server**. It never throws, and the result is
memoized at the module level for the life of the process.

## Edge downgrade example

If you explicitly request the axios adapter but the detected runtime is edge
(`capabilities.supportsAxios === false`), the client silently downgrades to
`fetch` rather than failing (`environment/edgeSafe.ts`):

```ts
createClient({
  baseURL: 'https://api.example.com',
  http: { adapter: 'axios' },   // requested...
  openapi: { mode: 'runtime' },
})
// ...but on Cloudflare Workers / Vercel Edge, this transparently becomes
// the fetch adapter — no error, no config change needed on your part.
```

This is why the CLAUDE.md architecture note describes adapter choice as
"`fetch` or `axios`, chosen by `environment/` detection (edge downgrades
axios→fetch)" — there's no separate edge-specific config; it's automatic
based on `PlatformCapabilities.supportsAxios`.

## Manual `setEnvironment` override

Useful for an admin/debug panel that lets an operator point the same running
app at a different backend without a reload:

```ts
const api = createClient({
  environments: { dev: 'http://localhost:3000', prod: 'https://api.example.com' },
  activeEnvironment: 'dev',
  openapi: { mode: 'runtime' },
})

function switchToProd() {
  api.setEnvironment('prod')   // throws ConfigurationError if 'prod' isn't in the map
  // any cached responses from 'dev' are now gone — the next call re-fetches
}
```

**See it live:** the Feature Lab "Environments" button calls
`api.setEnvironment(...)` to switch the active base URL at runtime and shows the
resolved config change —
[`examples/react-vite/src/features/FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx).

## Gotchas / troubleshooting

- **"`setEnvironment` throws immediately."** The name must already be a key in
  the `environments` map passed to `createClient` — it can't introduce a new
  host on the fly.
- **"All my cached data vanished after switching environments."** Expected —
  `setEnvironment` clears the whole cache (`cache.clear()` semantics), same as
  [logout](./authentication.md#logout-clearing-the-cache), to prevent
  cross-environment data leaking.
- **"Axios options I set are being ignored on edge."** Check
  `detectEnvironment().capabilities.supportsAxios` — on edge runtimes it's
  always `false` and the fetch adapter is used regardless of `http.adapter`.
- Related: [modules & methods](./modules-and-methods.md#module-level-configuration)
  for per-module `baseURL` overrides, [caching](./caching.md) for what "clears
  the cache" actually clears.
