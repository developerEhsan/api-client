# Retries & backoff

[← Docs index](./README.md)

Failed requests are retried when they are **retryable** (5xx, 429, network, and
timeout errors by default).

```ts
http: {
  retry: {
    attempts: 3,                 // total tries
    backoff: 'exponential',      // 'exponential' | 'linear' | 'fixed'
    baseDelay: 500,              // ms
    maxDelay: 30_000,            // ms — hard ceiling (also caps Retry-After)
    jitter: true,                // full-jitter to avoid thundering herds
    retryOn: (error) => error.status === 503,   // custom predicate
    onRetry: (attempt, error) => console.warn('retry', attempt, error.status),
  },
}
```

- A `429`/`503` with a `Retry-After` header is honored (seconds **or**
  HTTP-date), but never longer than `maxDelay`.
- Backoff waits are **abort-interruptible** — cancelling stops the wait
  immediately.
- 4xx (except 401 handled by [auth](./authentication.md)) are **not** retried by
  default.
- Each retry attempt gets a fresh [timeout](./timeouts-and-cancellation.md)
  budget.

## See it live

The Feature Lab "Retry & backoff" button calls a deliberately-failing endpoint
(`/http/500`) so you can watch `onRetry` fire on the live log for each attempt,
then a typed `ApiError` surface after the attempts are exhausted:
[`examples/react-vite/src/features/FeatureLab.tsx`](../examples/react-vite/src/features/FeatureLab.tsx).

The Next.js example logs every retry via the `onRetry` hook —
[`examples/nextjs/lib/api/api.config.ts`](../examples/nextjs/lib/api/api.config.ts).

## Advanced: standalone retry utility

For non-pipeline code you can use the exported helper directly:

```ts
import { withRetry, computeBackoff, parseRetryAfter } from '@developerehsan/api-client'
```

See the [API reference](./api-reference.md#standalone-utilities).
</content>
