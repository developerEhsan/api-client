# Hooks & events

[← Docs index](./README.md)

Two ways to observe and transform the pipeline: **declarative hooks** (in config)
and an **imperative event emitter** (`api.on` / `api.off`).

## Lifecycle hooks (config)

```ts
createClient({
  hooks: {
    onRequest:  (req) => ({ ...req, headers: { ...req.headers, 'X-Trace': id() } }),
    onResponse: (res) => res,
    onError:    (err) => log(err),
    onRetry:    (attempt, err) => {},
    onCacheHit: (key, entry) => {},
    onCacheMiss:(key) => {},
  },
})
```

- `onRequest`/`onResponse` may **transform** (and must return) their argument.
- Hooks compose across **global → module → per-call** layers.

**See it live:** the Next.js example wires `onCacheHit` and `onRetry` hooks —
[`examples/nextjs/lib/api/api.config.ts`](../examples/nextjs/lib/api/api.config.ts).

## Event emitter (imperative)

```ts
const handler = (payload) => {}
api.on('request', handler)     // 'request' | 'response' | 'error' | 'cacheHit' | 'cacheMiss'
api.off('request', handler)
```

**See it live:** the React example's `useEventLog` hook subscribes to
`request`/`response`/`error` and mirrors them into the Feature Lab's live log —
this is how the whole demo visualizes the pipeline:
[`examples/react-vite/src/components/ui.tsx`](../examples/react-vite/src/components/ui.tsx).

## Dev logging

A quick way to see everything without wiring hooks:

```ts
createClient({ dev: { logging: 'verbose' } })   // true | 'verbose' | false
```

Both examples enable `dev.logging` so every request/response prints to the
console.
</content>
