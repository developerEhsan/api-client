# Configuration reference

[← Docs index](./README.md)

Configuration comes in three layers and is **deep-merged** in this order (later
wins):

```
library defaults  →  global config  →  module config  →  per-call config
```

Arrays (e.g. header sets) are merged, not replaced.

## Global config (`createClient(config)`)

```ts
interface GlobalConfig {
  baseURL: string
  environments?: Record<string, string>   // named base URLs — see environments.md
  activeEnvironment?: string

  openapi: {
    mode?: 'codegen' | 'runtime' | 'auto'  // default 'auto'
    schemaPath?: string                     // for codegen
    runtimeURL?: string                     // fetch spec at runtime (dev)
    validation?: {
      enabled?: boolean
      mode?: 'strict' | 'loose'             // throw vs. warn
      onDriftDetected?: (diff) => void
    }
  }

  http?: {
    adapter?: 'axios' | 'fetch' | HttpAdapter   // default 'axios'
    timeout?: number                             // ms, default 10_000
    headers?: Record<string, string>
    deduplication?: boolean                      // default true
    dedupeMethod?: string[]                      // default ['GET']
    queue?: { enabled?: boolean; concurrency?: number; priority?: 'fifo' | 'lifo' }
    retry?: {
      attempts?: number                          // default 3
      backoff?: 'exponential' | 'linear' | 'fixed'
      baseDelay?: number; maxDelay?: number      // ms
      jitter?: boolean                           // default true (full-jitter)
      retryOn?: (error: ApiError) => boolean
      onRetry?: (attempt: number, error: ApiError) => void
    }
  }

  auth?: AuthConfig                              // see authentication.md
  cache?: CacheConfig                            // see caching.md
  cancellation?: { dedupeWindow?: number; cancelOnUnmount?: boolean }
  tenancy?: { headerName?: string; getTenantId?: () => string | Promise<string> }
  dev?: { logging?: boolean | 'verbose'; validateResponses?: boolean; schemaRefreshInterval?: number }
  hooks?: LifecycleHooks                         // see hooks-and-events.md
  safeMode?: boolean                             // see responses-and-errors.md
  modules?: Record<string, ModuleDefinition>
}
```

**See it live:** the example config sets `baseURL`, `openapi`, `auth`, `http`,
`cache`, `cancellation`, `dev`, and `modules` together in
[`examples/react-vite/src/lib/api/api.config.ts`](../examples/react-vite/src/lib/api/api.config.ts).

## Module config

Set on a module via `defineModule({ config: { ... } })`. Supported keys:
`baseURL`, `timeout`, `headers`, `auth`, `cache`, `retry`, `tenancy`,
`validation`. Each overrides the global value **for that module only**. See
[modules & methods](./modules-and-methods.md#module-level-configuration).

## Per-call config

Pass as the last argument through your method to `ctx.request(spec, perCall)`:

```ts
interface PerCallConfig {
  signal?: AbortSignal                 // cancellation
  headers?: Record<string, string>
  tenantId?: string                    // override tenant for this call
  cache?: { enabled?: boolean; ttl?: number; bust?: boolean }
  retry?: { attempts?: number }
  timeout?: number
  skipAuth?: boolean                   // send unauthenticated
  skipDedup?: boolean
  responseType?: 'json' | 'blob' | 'text' | 'arraybuffer'
}
```

Example:

```ts
await api.users.get('42', { timeout: 2000, cache: { bust: true } })
```

The Feature Lab uses per-call config for its timeout (`{ timeout: 1 }`) and
cancellation (`{ signal }`) demos — see
[`FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx).

## Reading & updating config at runtime

```ts
api.config.get()             // the resolved global config
api.config.update(partial)   // shallow-merge a partial update
api.setEnvironment('staging')  // switch base URL (clears cache) — see environments.md
```
</content>
