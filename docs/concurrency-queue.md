# Concurrency queue

[← Docs index](./README.md)

Limit how many requests are in flight at once (useful against rate limits):

```ts
http: {
  queue: {
    enabled: true,        // default
    concurrency: 6,       // max simultaneous requests (default 10)
    priority: 'fifo',     // 'fifo' (default) or 'lifo'
  },
}
```

Requests beyond the limit wait their turn. Aborting a queued (not-yet-started)
request removes it from the queue and rejects it.

**See it live:** the example configures `http.queue.concurrency: 6` —
[`examples/react-vite/src/lib/api/api.config.ts`](../examples/react-vite/src/lib/api/api.config.ts).
Combined with [deduplication](./deduplication.md), the Feature Lab's "Deduplication
(6→1)" burst demonstrates how concurrent traffic is managed.

## Advanced: standalone queue utility

```ts
import { createQueue } from '@developerehsan/api-client'
```

See the [API reference](./api-reference.md#standalone-utilities).
</content>
