# Timeouts & cancellation

[← Docs index](./README.md)

## Timeouts

Set `http.timeout` (or per call). Enforced on **every** adapter — including
`fetch`, which does not time out on its own. Exceeding it raises a
`TimeoutError` (which is retryable). Each retry attempt gets a fresh budget.

```ts
await api.reports.generate(input, { timeout: 60_000 })
```

**See it live:** the Feature Lab "Timeout (1ms)" button sets a 1ms per-call
timeout and catches the resulting `TimeoutError` —
[`FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx).

## Cancellation with AbortSignal

```ts
const controller = new AbortController()
const promise = api.users.list(params, { signal: controller.signal })
controller.abort()   // rejects with an AbortError; no further retries
```

`AbortError`s propagate to the caller as-is (they are never swallowed or turned
into cache hits), even under [`safeMode`](./responses-and-errors.md#safemode-no-throw).

**See it live:** the Feature Lab "Cancellation" button starts a request then
aborts it and catches the `AbortError` (via `isAbortError`) —
[`FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx).

## Debounce-cancel (typeahead)

Set `cancellation.dedupeWindow` so a newer call for the same endpoint within the
window auto-cancels the previous in-flight one:

```ts
createClient({ cancellation: { dedupeWindow: 300 } })
// Rapid api.search.query('a'), ('ab'), ('abc') — earlier ones are aborted.
```

**See it live:** the direct-client search box uses the 300ms `dedupeWindow` so
fast typing auto-cancels superseded searches; the superseded `AbortError` is
swallowed so only the latest result wins —
[`DirectClientDemo.tsx`](../examples/react-vite/src/features/DirectClientDemo.tsx)
(window configured in [`api.config.ts`](../examples/react-vite/src/lib/api/api.config.ts)).

## Over the SSR RPC bridge

Pass an `AbortSignal` as usual — the signal is honored **locally** and rejects
with an `AbortError`; it is not serialized over the wire. See
[SSR RPC bridge](./ssr-rpc-bridge.md#cancellation).
</content>
