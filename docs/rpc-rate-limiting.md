# RPC rate limiting

[← Docs index](./README.md)

An [SSR RPC bridge](./ssr-rpc-bridge.md) handler is a single server endpoint
that fans out to arbitrary backend calls — without a limiter, one abusive
client (or a runaway retry loop on the frontend) can hammer it with unlimited
requests. `createRateLimiter` plugs into the handler's `onRequest` hook to
throttle per-IP or per-session, with a pluggable counter store.

## Config shape (verified against `packages/core/src/server/rateLimit.ts` and `createRpcHandler.ts`)

```ts
import { createRateLimiter, createRpcHandler } from '@developerehsan/api-client/server'

const limiter = createRateLimiter({
  windowMs: 10_000,   // required: window length in ms
  max: 30,            // required: max requests per key per window
  keyFor: async (ctx, call) => (await ctx.getCookie?.('demo_session')) ?? 'anon',
  trustProxy: false,  // default false — only honor X-Forwarded-For behind a trusted proxy
  store: undefined,   // default: bounded in-memory fixed-window store
  maxKeys: 10_000,    // default: LRU bound on the default memory store's distinct keys
})

export const rpcHandler = createRpcHandler(api, {
  expose: { pet: ['getPetById', 'findPetsByStatus'] },   // required, deny-by-default
  onRequest: limiter.onRequest,   // throws to reject over-budget calls
})
```

`RateLimiterOptions` fields, exactly as declared:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `windowMs` | `number` | required | Fixed window length in ms |
| `max` | `number` | required | Max requests per key per window |
| `keyFor` | `(ctx, call) => string \| Promise<string>` | first `X-Forwarded-For` hop if `trustProxy`, else `"global"` | Derives the bucket key |
| `trustProxy` | `boolean` | `false` | Only honor `X-Forwarded-For` when a trusted proxy sets it — leaving this `false` behind an untrusted edge means one spoofed header can't forge a different bucket |
| `store` | `RateLimitStore` | bounded in-memory fixed-window store | Swap for Redis etc. for multi-instance deployments |
| `maxKeys` | `number` | `10_000` | LRU bound on distinct keys held by the *default* memory store |

`createRpcHandler`'s own dispatch order (`createRpcHandler.ts:169`):
**allowlist (`expose`) → input caps (`maxInputDepth`/`maxInputKeys`) →
`authorize` → `onRequest` → dispatch → `transformResult`** — so the rate
limiter (wired as `onRequest`) runs *after* the exposure/authorization checks
already passed, meaning unauthorized calls are rejected before they ever
consume rate-limit budget.

## Client-visible behavior on a 429

Over budget, `createRateLimiter`'s `check()` throws `new
RpcSecurityError('rate_limited', 429)` (`rateLimit.ts:138`) — a uniform,
sanitized denial that rides the `RpcResponse` envelope as `status: 429`,
`code: 'rate_limited'`. The `/browser` client rehydrates this into a real
`ApiError` with `status === 429`:

```ts
try {
  await rpcClient.pet.getPetById({ id: 1 })
} catch (err) {
  if (err instanceof ApiError && err.status === 429) {
    // show a "slow down" message; ApiError.isRetryable is true for 429
    // (errors/ApiError.ts:66), so a retry policy will back off and retry it.
  }
}
```

Because it runs per RPC **call**, not per HTTP request, a single **batched**
request (multiple calls in one POST) is rate-limited per sub-call — a batch of
5 calls consumes 5 units of budget, not 1.

## Worked example: per-session vs per-IP

Per-session (cookie-keyed), the default shown above, is the safer default
when you don't control the proxy layer — it doesn't depend on trusting a
spoofable header. Per-IP requires an explicit opt-in because the default key
derivation only reads `X-Forwarded-For` when you assert you're behind a
trusted proxy that sets it honestly:

```ts
// Per-IP, ONLY if you terminate a trusted proxy that sets X-Forwarded-For:
const limiter = createRateLimiter({ windowMs: 10_000, max: 30, trustProxy: true })

// Per-session, no proxy trust required (the default keyFor pattern):
const limiter = createRateLimiter({
  windowMs: 60_000,
  max: 100,
  keyFor: async (ctx) => (await ctx.getCookie?.('session')) ?? 'anon',
})
```

## Worked example: shared store for multi-instance deployments

The default in-memory store is per-process — on multiple server instances
behind a load balancer, each instance has its own budget, so the effective
limit is `max * instanceCount`. Pass a `store` backed by something shared
(e.g. Redis) to enforce one true limit across instances:

```ts
const limiter = createRateLimiter({
  windowMs: 60_000,
  max: 100,
  store: myRedisBackedStore,   // implements RateLimitStore: hit(key, windowMs, now)
})
```

**See it live:** the Next.js example wires a 30-calls-per-10s limiter keyed by a
session cookie into the handler's `onRequest` —
[`examples/nextjs/lib/api/api.config.ts`](../examples/nextjs/lib/api/api.config.ts).

## Related handler options

| Option | Purpose |
| --- | --- |
| `expose` | Required deny-by-default allowlist of module/method calls |
| `onRequest` | Where the limiter attaches; also good for logging |
| `authorize` | Per-call permission (see [SSR RPC bridge](./ssr-rpc-bridge.md#security-model-deny-by-default)) — runs *before* `onRequest` |
| `maxBatchSize` | Cap how many calls a single batch may carry (default `10`) |
| `maxInputDepth` / `maxInputKeys` | Input DoS caps (defaults `8` / `1000`), checked before `authorize`/`onRequest` |
| `maxBodyBytes` (route, `createRpcRouteHandler`) | Body-size cap on the generic HTTP route (default `128 * 1024`) |

## Gotchas / troubleshooting

- **"Rate limit resets seem inconsistent across instances."** The default
  store is per-process in-memory — pass a shared `store` (Redis-backed) for
  multi-instance deployments, or accept that the effective limit multiplies
  by instance count.
- **"A client behind a corporate proxy shares a budget with others."** Expected
  with the default `keyFor` when `trustProxy` is `false` — everyone falls into
  the `"global"` bucket unless you supply a `keyFor` that reads something
  client-specific (a session cookie, an authenticated user id).
- **"429s aren't retried automatically."** They are, by default — `ApiError`
  treats `status === 429` as retryable (`errors/ApiError.ts:66`); check your
  `http.retry` config on the *client* side (see [retries](./retries.md)) isn't
  disabling retry or excluding 429 via `retryOn`.
- Related: [SSR RPC bridge](./ssr-rpc-bridge.md) for the full trust-boundary
  model this limiter plugs into, [retries](./retries.md) for client-side 429
  handling.
