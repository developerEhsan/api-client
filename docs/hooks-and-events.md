# Hooks & events

[← Docs index](./README.md)

Two ways to observe and transform the pipeline: **declarative hooks** (in
config, can transform request/response) and an **imperative event emitter**
(`api.on` / `api.off`, observation only — payloads are read-only, listeners
can't alter what the caller receives).

## Lifecycle hooks (config)

`LifecycleHooks` (`packages/core/src/types/config.types.ts`) has exactly
**8** fields, confirmed by reading the interface:

```ts
createClient({
  hooks: {
    onRequest:   (req) => ({ ...req, headers: { ...req.headers, 'X-Trace': id() } }),
    onResponse:  (res) => res,
    onError:     (err) => log(err),
    onRetry:     (attempt, err) => {},
    onCacheHit:  (key, entry) => {},
    onCacheMiss: (key) => {},
    onSuccess:   (res) => {},
    onSettled:   (res, err) => {},
  },
})
```

- `onRequest`/`onResponse` may **transform** (and must return) their argument;
  when set at multiple layers (global → module → per-call) they **chain** —
  each hook receives the previous layer's output. Both may be async.
- `onError` only **observes** — it cannot suppress or replace the thrown
  error.
- `onRetry(attempt, error)` fires before each re-attempt with the 1-based
  attempt number just failed.
- `onCacheHit(key, entry)` / `onCacheMiss(key)` fire on the cache lookup — see
  [caching](./caching.md).
- `onSuccess(response)` fires once a request resolves successfully (from
  network **or** cache), just before the response reaches the caller — purely
  observational.
- `onSettled(response, error)` fires **exactly once** per request regardless
  of outcome — the `finally` of the request lifecycle
  (`createClient.ts`'s `run`, in a `finally` block). Exactly one of
  `response`/`error` is set on success/failure; **both are `undefined` on
  cancellation** (an aborted request doesn't populate either). It's `await`ed,
  so an async `onSettled` completes before the request promise itself
  resolves.

**See it live:** the Next.js example wires `onCacheHit` and `onRetry` hooks —
[`examples/nextjs/lib/api/api.config.ts`](../examples/nextjs/lib/api/api.config.ts).

## Worked example: one hook per field

```ts
createClient({
  baseURL: 'https://api.example.com',
  openapi: { mode: 'runtime' },
  hooks: {
    onRequest:   (req) => ({ ...req, headers: { ...req.headers, 'X-Request-Id': crypto.randomUUID() } }),
    onResponse:  (res) => { metrics.timing('http.response', Date.now() - res.headers['x-start']); return res },
    onError:     (err) => Sentry.captureException(err),
    onRetry:     (attempt, err) => logger.warn(`retry ${attempt}`, { status: err.status }),
    onCacheHit:  (key) => metrics.increment('cache.hit'),
    onCacheMiss: (key) => metrics.increment('cache.miss'),
    onSuccess:   (res) => logger.debug('ok', res.status),
    onSettled:   (res, err) => logger.debug('settled', { ok: !err, status: res?.status }),
  },
})
```

## Worked example: layering hooks (global → module → per-call)

```ts
createClient({
  baseURL,
  hooks: { onRequest: (req) => ({ ...req, headers: { ...req.headers, 'X-Global': '1' } }) },
  modules: {
    users: {
      config: {
        hooks: { onRequest: (req) => ({ ...req, headers: { ...req.headers, 'X-Module': '1' } }) },
      },
    },
  },
})

// This call's request ends up with BOTH X-Global and X-Module headers —
// each layer receives the previous layer's already-transformed request.
await api.users.get('42', undefined, {
  hooks: { onRequest: (req) => ({ ...req, headers: { ...req.headers, 'X-Call': '1' } }) },
})
```

## Event emitter (imperative)

The emitter fires the same lifecycle moments as an event stream, for code
that wants to subscribe/unsubscribe dynamically rather than bake hooks into
config. Verified event names, from every `emit(...)` call site in
`createClient.ts`:

```ts
const handler = (payload) => {}
api.on('request', handler)
api.on('response', handler)
api.on('error', handler)
api.on('cacheHit', handler)
api.on('cacheMiss', handler)
api.on('success', handler)
api.on('settled', handler)   // payload: { response, error } — same both-undefined-on-abort rule as onSettled
api.off('request', handler)
```

That's 7 named events — one per hook except `onRequest`/`onResponse`, which
also fire `'request'`/`'response'` events carrying the (already
hook-transformed) value. Module-scoped work additionally emits
`module:<name>:<event>` internally, but the 7 above are the public,
documented surface.

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

## Gotchas / troubleshooting

- **"My `onRequest` hook's changes disappeared."** Make sure you `return` the
  modified request — returning `void`/`undefined` is treated as "pass through
  unchanged," not "clear the request."
- **"`onSettled` gave me `undefined` for both `response` and `error`."**
  Expected on cancellation (an aborted call) — that's the documented
  both-undefined case, not a bug.
- **"`onError` didn't stop the request from throwing."** By design — `onError`
  is observation-only, it can never suppress the throw. If you need to
  swallow or transform an error, do it at the call site with try/catch.
- **`hooks` config vs `api.on`/`api.off`:** hooks compose across
  global/module/per-call config layers and can transform values; events are a
  flat, dynamic subscribe/unsubscribe surface and are read-only. Pick hooks
  for anything that needs to run at a specific config layer or mutate the
  request/response; pick events for ad hoc logging/telemetry wiring.
- Related: [caching](./caching.md) for `onCacheHit`/`onCacheMiss` detail,
  [retries](./retries.md) for `onRetry` timing.
