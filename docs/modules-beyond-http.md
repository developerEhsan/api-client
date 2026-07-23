# Modules beyond HTTP

[← Docs index](./README.md)

A module method doesn't have to call HTTP. The **module context** (`ctx`) gives
you primitives to run any async logic through the same infrastructure, plus
emit events, log, and read config.

## The module context

```ts
interface ModuleContext {
  request(spec, perCall?): Promise<ApiResponse<T>>   // the HTTP pipeline
  run(label, fn, options?): Promise<T>               // any async logic, wrapped
  stream(spec, options?): AsyncIterable<...>          // streaming — see streaming.md
  client: ApiClient                                   // call other modules
  config: ResolvedConfig                              // resolved config
  emit(event, payload?): void                         // fire a custom event
  logger: ModuleLogger                                // honors dev.logging
}
```

## `ctx.run` — arbitrary async logic with pipeline features

Wrap any async work to get **opt-in** queue / dedup / retry / timeout — the same
guarantees HTTP calls get:

```ts
analytics: defineModule({
  methods: {
    summarize: async (ctx) =>
      ctx.run(
        'summarize',                 // dedup/label key
        async () => {
          const top = (await ctx.request({ method: 'GET', path: '/products', query: { limit: 100 } })).data
          const avgPrice = top.products.reduce((s, p) => s + p.price, 0) / (top.products.length || 1)
          return { count: top.total, avgPrice: Math.round(avgPrice * 100) / 100 }
        },
        { dedupe: true, retry: { attempts: 2 } },
      ),
  },
})
```

**See it live:** the `analytics.summarize` module in
[`examples/react-vite/src/lib/api/api.config.ts`](../examples/react-vite/src/lib/api/api.config.ts)
is a brand-new module (not in the OpenAPI spec) that uses `ctx.run`, surfaced by
the Feature Lab "ctx.run (analytics)" button.

## `ctx.emit` / `ctx.logger` / `ctx.config`

- `ctx.emit('somethingHappened', payload)` — fire a custom event that `api.on`
  listeners receive. See [hooks & events](./hooks-and-events.md).
- `ctx.logger.info(...)` — logs only when `dev.logging` is on.
- `ctx.config` — the resolved config (base URL, timeouts, etc.).

## Why this matters

It lets a single client be the home for *all* your data access — HTTP endpoints,
derived/aggregated data, cache-warming jobs, or even a future non-HTTP transport
— behind one consistent `api.module.method()` surface.
</content>
