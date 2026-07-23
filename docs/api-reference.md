# Full API reference

[← Docs index](./README.md)

Every public symbol, grouped by entry point. For narrative usage, follow the
per-feature guides linked from the [docs index](./README.md).

## `@developerehsan/api-client`

### Factory

- `createClient(config: GlobalConfig): ApiClient` — dynamic/untyped client
- `createTypedClient<OperationsMap>()(config, generatedModules): TypedApiClient` — fully-typed, curried; `config.modules` is the source of truth and overrides generated methods per-method
- `createModuleDefiner<Ops, typeof generatedModules>()` → `defineModule('store', {...})` with method-name + input autocomplete
- `buildModulesFromDescriptors(descriptors)` — build runtime modules from a generated descriptor map
- `defineModule({ config?, methods, extends? }): ModuleDefinition`

### Client instance members

- `api.[module].[method](...args)` — your declared methods
- `api.cache.get(key)` / `.clear()` / `.invalidate(pattern?)`
- `api.config.get()` / `.update(partial)`
- `api.setEnvironment(name)`
- `api.getSchema()`
- `api.on(event, handler)` / `api.off(event, handler)`

### Errors

`ApiError`, `NetworkError`, `TimeoutError`, `AuthError`, `SchemaError`,
`SchemaParseError`, `ConfigurationError`, `classifyError`, `extractServerError`.
See [responses & errors](./responses-and-errors.md).

### Adapters

`createFetchAdapter()`, `createAxiosAdapter(instance?)`, `detectEnvironment()`,
type `HttpAdapter`.

### Auth

`createAuthManager(deps)`, and config types
`BearerAuthConfig` / `CookieAuthConfig` / `ApiKeyAuthConfig` / `OAuth2AuthConfig`.
See [authentication](./authentication.md).

### Tenancy & server context

`runWithTenant(id, fn)`, `getTenantFromContext()`, `hasTenantContext()`,
`resolveTenantId(input)`, `readServerHeader(name)`, `readServerCookie(name)`,
`serverTenantResolver(headerName?)`, `serverTokenFromCookie(cookieName?)`.
See [multi-tenancy](./multi-tenancy.md).

### Runtime schema

`createSchemaCache()`, `createSchemaLoader(deps)`, `diffSchemas(a, b)`,
`hashSchema(ast)`, `hasDrift(diff)`, `handleDrift(diff, policy)`,
`validateValue(value, type, ast)`,
`validateResponseBody(ast, path, method, status, body)`.
See [schema validation](./schema-validation.md).

### Streaming

`parseSse`, `parseNdjson`, types `StreamOptions`, `StreamRunner`, `SseEvent`.
See [streaming](./streaming.md).

### Standalone utilities (advanced)

`createDeduplicator()`, `computeDedupeKey(input)`, `createCache(config)`,
`computeCacheKey(input)`, `isFresh(entry, now)`, `createQueue(config)`,
`createCancellationManager(config)`, `isAbortError(err)`, `linkSignals(...signals)`,
`withRetry(fn, opts, deps?)`, `computeBackoff(...)`, `parseRetryAfter(headers)`.

## `@developerehsan/api-client/server` (SSR RPC bridge — server)

- `createRpcHandler(api, options): RpcHandler` — options: `expose` (required, deny-by-default, typed allowlist), `authorize?`, `onRequest?`, `onError?`, `transformResult?`, `maxInputDepth?`, `maxInputKeys?`, `maxTimeout?`, `maxBatchSize?`, `dev?`
- `createNextRpcAction(handler): NextRpcAction` — wrap as a Next.js Server Action
- `createRpcRouteHandler(handler, { csrf?, allowedOrigins?, maxBodyBytes? }): (Request) => Promise<Response>`
- `createStartRpcRoute(handler)` / `createRemixRpcAction(handler)` — TanStack Start / Remix glue
- `createRateLimiter({ windowMs, max, keyFor?, trustProxy?, store? })` — see [RPC rate limiting](./rpc-rate-limiting.md)
- `RpcSecurityError`, types `RpcHandlerOptions`, `ExposeMap`, `RpcRequestContext`, `RpcCall`, `RpcResponse`, `RpcErrorShape`

## `@developerehsan/api-client/browser` (SSR RPC bridge — browser)

- `createRpcClient<Api>(transport, { batch?, maxBatchSize? }): RpcClient<Api>` — dependency-free proxy; `Api` is a **type-only** import
- `serverActionTransport(action)`, `httpTransport({ endpoint, fetch?, headers? })`
- `ApiError` (for `instanceof` after rehydration), `isRpcErrorShape`, `isRpcResponse`, types `Transport`, `RpcPerCall`, `RpcClient`

## `@developerehsan/api-client/cache-stores`

`createMemoryPersistentStore()`, `createIndexedDbStore(options?)`,
`createRedisStore(client, options?)`, `createLayeredCacheStore(...)`,
`isCacheEntry`, type `PersistentCacheStore`.
See [cache persistence](./cache-persistence.md).

## `@developerehsan/api-client/codegen` (Node only)

`generate(options)`, `validate(input)`, `diff(input, output)`,
`defineCodegenConfig(config)`, `loadCodegenConfig()`, `watchAndGenerate(...)`,
`withApiClientCodegen(nextConfig, options)`, `parseOpenApi(doc)`,
`emitTypes(ast, opts?)`, `emitModules(ast, opts?)`, `emitRpcModules(ast, opts?)`,
`emitReactQueryHooks(ast, opts?)`.
See [codegen](./codegen.md).

## `@developerehsan/api-client/testing`

`createMockClient(options)`, `createMockAdapter()`.
See [testing](./testing.md).

## `@developerehsan/api-client-query/{react,vue,solid}`

`createQueryIntegration(client, { modules, getNextPageParam?, pageParamName? })`,
`moduleKey(module)`, `methodKey(module, method, params?)`.
See [TanStack Query](./tanstack-query.md).

## `@developerehsan/api-client-vite`

`apiClientCodegen(options?)` — Vite plugin (also covers TanStack Start).
See [codegen](./codegen.md#vite-plugin-also-covers-tanstack-start).
</content>
