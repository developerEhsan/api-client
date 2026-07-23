# RPC rate limiting

[← Docs index](./README.md)

The [SSR RPC bridge](./ssr-rpc-bridge.md) handler exposes an `onRequest` hook
that runs before every dispatch. `createRateLimiter` plugs into it to throttle
abusive clients — per-IP or per-session, with a pluggable store.

```ts
import { createRateLimiter, createRpcHandler } from '@developerehsan/api-client/server'

const limiter = createRateLimiter({
  windowMs: 10_000,
  max: 30,
  // Key by session cookie, falling back to a shared bucket:
  keyFor: async (ctx) => (await ctx.getCookie?.('demo_session')) ?? 'anon',
  // For per-IP: use trustProxy + the request's address instead of keyFor.
})

export const rpcHandler = createRpcHandler(api, {
  expose: { /* ... */ },
  onRequest: limiter.onRequest,   // throws to reject over-budget calls
})
```

- Over budget → a uniform `rate_limited` error (HTTP 429 in the RPC envelope),
  rehydrated as an `ApiError` on the browser.
- The default store is in-memory; pass a custom store for multi-instance
  deployments.
- Because it runs per RPC **call**, a batched request is rate-limited per
  sub-call.

**See it live:** the Next.js example wires a 30-calls-per-10s limiter keyed by a
session cookie into the handler's `onRequest` —
[`examples/nextjs/lib/api/api.config.ts`](../examples/nextjs/lib/api/api.config.ts).

## Related handler options

| Option | Purpose |
| --- | --- |
| `onRequest` | Where the limiter attaches; also good for logging |
| `authorize` | Per-call permission (see [SSR RPC bridge](./ssr-rpc-bridge.md#security-model-deny-by-default)) |
| `maxBatchSize` | Cap how many calls a single batch may carry |
| `maxInputDepth` / `maxInputKeys` | Input DoS caps |
| `maxBodyBytes` (route) | Body-size cap on the generic HTTP route |
</content>
