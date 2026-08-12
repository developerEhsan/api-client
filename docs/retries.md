# Retries & backoff

[← Docs index](./README.md)

Transient failures — a flaky network hop, a backend that's momentarily
overloaded (503), a rate limit (429) — often succeed on a second try. Rather
than making every caller hand-roll a retry loop, the client retries
**retryable** failures (5xx, 429, network, and timeout errors by default)
automatically, with configurable backoff.

## Config shape

```ts
http: {
  retry: {
    attempts: 3,                 // total tries, including the first (default 3)
    backoff: 'exponential',      // 'exponential' | 'linear' | 'fixed' (default 'exponential')
    baseDelay: 500,              // ms (default 500)
    maxDelay: 30_000,            // ms — hard ceiling, also caps Retry-After
    jitter: true,                // full-jitter to avoid thundering herds (default true)
    retryOn: (error) => error.status === 503,   // custom predicate
    onRetry: (attempt, error) => console.warn('retry', attempt, error.status),
  },
}
```

## Backoff formula (verified against `utilities/retry.ts`'s `computeBackoff`)

For 1-based retry attempt `n`:

| `backoff` | Delay before capping/jitter |
| --- | --- |
| `'exponential'` (default) | `baseDelay * 2 ** (n - 1)` → `500, 1000, 2000, 4000, ...` |
| `'linear'` | `baseDelay * n` → `500, 1000, 1500, 2000, ...` |
| `'fixed'` | `baseDelay` every time → `500, 500, 500, ...` |

That raw delay is then:

1. **Capped** at `maxDelay`: `Math.min(delay, maxDelay)`.
2. **Jittered**, if `jitter` (default `true`): replaced with
   `Math.random() * cappedDelay` — this is **full jitter** (a random value
   between `0` and the capped delay), not "cap ± a percentage."

A response's `Retry-After` header (seconds or an HTTP-date, parsed by
`parseRetryAfter`) **takes priority over the strategy** entirely — when
present it's used as-is, still capped by `maxDelay`, but never run through the
backoff formula or jitter:

```ts
// computeBackoff, simplified:
if (retryAfterMs !== undefined) return Math.min(retryAfterMs, maxDelay);
// otherwise: strategy formula -> cap at maxDelay -> jitter if enabled
```

- Backoff waits are **abort-interruptible** — cancelling the request's
  `AbortSignal` stops the wait immediately rather than sleeping out the full
  delay.
- 4xx errors (except 401, handled by [auth](./authentication.md)'s
  refresh flow) are **not** retried by default — override with `retryOn` if
  you have a specific 4xx that's safe to retry.
- Each retry attempt gets a fresh [timeout](./timeouts-and-cancellation.md)
  budget — a slow attempt timing out doesn't shrink the budget available to
  the next attempt.

## Worked example: custom `retryOn` condition

The default retryable set is 5xx/429/network/timeout. To retry only a
specific status your backend uses for "try again shortly" (e.g. 425 Too
Early), or to *narrow* the default set:

```ts
http: {
  retry: {
    attempts: 4,
    retryOn: (error) => error.status === 425 || error.isRetryable,   // custom + the built-in set
  },
}
```

`retryOn` fully replaces the default predicate when supplied — if you want the
built-ins plus one more case, OR it with `error.isRetryable` as above rather
than only checking your custom condition.

## Worked example: interaction with `AbortSignal` / timeouts

```ts
const controller = new AbortController()
setTimeout(() => controller.abort(), 5000)   // give up after 5s total, across all retries

try {
  await api.reports.generate(payload, undefined, { signal: controller.signal })
} catch (err) {
  // If the abort fires mid-backoff-wait, it rejects immediately as an
  // AbortError rather than completing the sleep and trying again.
}
```

Per-call `timeout` is a *per-attempt* budget (a fresh one each retry); the
`AbortSignal` above is the mechanism for bounding the *entire* multi-attempt
operation, including time spent sleeping between attempts. Use both together
when you need "give up on this attempt after Xs" and "give up on the whole
thing after Ys" to mean different things.

## See it live

The Feature Lab "Retry & backoff" button calls a deliberately-failing endpoint
(`/http/500`) so you can watch `onRetry` fire on the live log for each attempt,
then a typed `ApiError` surface after the attempts are exhausted:
[`examples/react-vite/src/features/FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx).

The Next.js example logs every retry via the `onRetry` hook —
[`examples/nextjs/lib/api/api.config.ts`](../examples/nextjs/lib/api/api.config.ts).

## Advanced: standalone retry utility

For non-pipeline code you can use the exported helpers directly:

```ts
import { withRetry, computeBackoff, parseRetryAfter } from '@developerehsan/api-client'
```

See the [API reference](./api-reference.md#standalone-utilities).

## Gotchas / troubleshooting

- **"My retries all happen instantly, no backoff."** Check you didn't set
  `jitter` in a way that makes delays look small by chance (full jitter can
  legitimately draw a near-zero delay) — that's expected, not a bug; jitter
  spreads a *distribution*, it doesn't guarantee a minimum wait.
- **"A 404 got retried."** It shouldn't by default; check a custom `retryOn`
  isn't accidentally broader than intended (`retryOn` fully replaces the
  default predicate).
- **"Retry-After from the server seems ignored."** It's honored but always
  capped by `maxDelay` — if `maxDelay` is set low, a large `Retry-After` gets
  clamped down rather than followed exactly.
- Related: [rpc-rate-limiting](./rpc-rate-limiting.md) for how a 429 from the
  RPC bridge specifically is retryable, [timeouts &
  cancellation](./timeouts-and-cancellation.md) for the per-attempt timeout
  budget mentioned above.
