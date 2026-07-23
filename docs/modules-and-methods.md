# Modules & methods

[← Docs index](./README.md)

A **module** is a named group of methods. You declare it with `defineModule`,
whose `methods` each receive a **`ctx`** (module context) as their first
argument. Callers never pass `ctx` — it is injected for you.

```ts
defineModule({
  methods: {
    // You write:  (ctx, ...yourArgs)
    // Callers use: api.invoices.get(id, perCall?)
    get: async (ctx, id: string, perCall?) =>
      (await ctx.request(
        { method: 'GET', path: '/invoices/{id}', pathParams: { id } },
        perCall,
      )).data,
  },
})
```

## `ctx.request(spec, perCall?)`

The one primitive that runs the [pipeline](./mental-model.md).

```ts
interface ModuleRequestSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  path: string                              // supports {placeholders}
  pathParams?: Record<string, string | number>
  query?: Record<string, unknown>           // serialized to the query string
  body?: unknown                            // JSON-serialized for you
}

ctx.request<T>(spec, perCall?): Promise<ApiResponse<T>>
```

- **Path params:** `path: '/orders/{orderId}/lines/{lineId}'` +
  `pathParams: { orderId, lineId }`. A missing required placeholder throws a
  `ConfigurationError` before any network call.
- **Query:** `query: { page: 1, tags: ['a', 'b'] }` → `?page=1&tags=a&tags=b`.
  `undefined`/`null` values are skipped.
- **Per-call overrides:** pass a second argument to override config for just this
  call — see [configuration §per-call](./configuration.md#per-call-config).

The return value is an [`ApiResponse<T>`](./responses-and-errors.md).

## Typing responses

Annotate the generic so callers get typed results:

```ts
type Invoice = { id: string; amount: number; status: 'draft' | 'paid' }

list: async (ctx): Promise<Invoice[]> =>
  (await ctx.request<Invoice[]>({ method: 'GET', path: '/invoices' })).data,
```

If you use [codegen](./codegen.md), import the generated types instead of writing
them by hand.

## Composed calls (calling multiple endpoints)

A method can perform several requests and combine them:

```ts
getWithLines: async (ctx, id: string) => {
  const invoice = (await ctx.request({ method: 'GET', path: '/invoices/{id}', pathParams: { id } })).data
  const lines   = (await ctx.request({ method: 'GET', path: '/invoices/{id}/lines', pathParams: { id } })).data
  return { invoice, lines }
},
```

**See it live:** `products.getWithSiblings` in
[`examples/react-vite/src/lib/api/api.config.ts`](../examples/react-vite/src/lib/api/api.config.ts)
fetches a product and its category siblings in one call, surfaced in the Feature
Lab "Composed call" button.

## Module-level configuration

```ts
defineModule({
  config: {
    baseURL: 'https://payroll.internal',   // this module hits a different host
    timeout: 30_000,
    auth: { strategy: 'apiKey', getKey: () => process.env.PAYROLL_KEY!, placement: 'header', name: 'X-Key' },
  },
  methods: { /* ... */ },
})
```

Supported module-config keys: `baseURL`, `timeout`, `headers`, `auth`, `cache`,
`retry`, `tenancy`, `validation`. Each overrides the global value for that module
only — see [configuration](./configuration.md).

## Two ways to build the client

### 1. `createClient` — dynamic / hand-written

Best for quick starts and apps without an OpenAPI spec. You write every method
yourself.

### 2. `createTypedClient` — end-to-end typed from a spec

Curried: `createTypedClient<OperationsMap>()(config, generatedModules)`. The
user's `config.modules` merges **over** the generated modules **per-method** —
custom methods and return types always win. This is what both examples use:

```ts
// examples/react-vite/src/lib/api/api.config.ts
export const api = createTypedClient<OperationsMap>()(
  {
    baseURL: 'https://dummyjson.com',
    modules: {
      auto: true,               // build auto-modules for every tag in the spec
      products: {
        methods: {
          getWithSiblings: async (ctx, id: number) => { /* custom, wins */ },
        },
      },
    },
  },
  generatedModules,
)
```

For method-*name* autocomplete on a known module, opt into
`createModuleDefiner`/`defineModule('store', {...})` — see the
[API reference](./api-reference.md).

## Modules beyond HTTP

A method doesn't have to call HTTP. `ctx.run` wraps arbitrary async logic with
the same opt-in queue/dedup/retry/timeout, and `ctx.stream` returns an
`AsyncIterable`. See [modules beyond HTTP](./modules-beyond-http.md) and
[streaming](./streaming.md).
</content>
