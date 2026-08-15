# Concurrency queue

[← Docs index](./README.md)

A browser or server process firing dozens of requests at once can overwhelm a
backend or trip its rate limiter. The concurrency queue caps how many
requests are **in flight simultaneously**; the rest wait their turn.

```ts
http: {
  queue: {
    enabled: true,        // default
    concurrency: 6,       // max simultaneous requests (default 10)
    priority: 'fifo',     // 'fifo' (default) or 'lifo'
  },
}
```

## How it actually schedules (verified against `utilities/queue.ts`)

`createQueue({ concurrency, priority })` keeps a `waiting` array and a
`running` counter. Whenever a slot frees up, `dispatch()` pulls the next item:

```ts
const item = priority === 'lifo' ? waiting.pop() : waiting.shift();
```

- **`'fifo'` (default):** `waiting.shift()` — strict first-in-first-out; the
  request that queued earliest runs next once a slot opens.
- **`'lifo'`:** `waiting.pop()` — the *most recently* queued request runs
  next, ahead of ones that have been waiting longer. Useful when only the
  newest request's result matters (e.g. a fast-typing search box) and older
  queued ones are effectively stale.
- There is **no separate priority level or per-request priority field** —
  `priority` is a single queue-wide scheduling mode, not a per-call priority
  you can attach to individual requests. All items in the queue are peers;
  ordering is purely FIFO or LIFO.
- Aborting a queued (not-yet-started) request via its `AbortSignal` removes it
  from `waiting` and rejects it immediately with an `AbortError` — it never
  occupies a concurrency slot.
- A per-call `queue: false` bypasses the queue entirely for that request
  (`createClient.ts`'s `queueForThisCall = resolved.queue ?? queueEnabled`);
  it runs immediately regardless of how many other requests are in flight.

## Per-module vs global queue

The queue is created **once** per client and shared across all modules and
even non-HTTP module calls (`createClient.ts`: "Shares the client's queue +
deduplicator so non-HTTP module work coordinates with HTTP requests") — there
is no separate queue instance per module. To give one module a different
effective concurrency, use the per-call/per-method escape hatch instead of
expecting a second global queue:

```ts
// Global queue: at most 6 concurrent requests across the WHOLE client.
const api = createClient({
  baseURL,
  http: { queue: { concurrency: 6 } },
  openapi: { mode: 'runtime' },
})

// Opt a specific, latency-sensitive call OUT of the shared queue so it never
// waits behind bulk/background traffic:
await api.search.query({ q }, undefined, { queue: false })
```

## Worked example: burst throttling against a rate-limited backend

If a backend enforces, say, 5 concurrent connections per client, set
`concurrency` to match (or slightly under) that limit so requests queue
client-side instead of getting rejected server-side:

```ts
const api = createClient({
  baseURL: 'https://api.example.com',
  http: {
    queue: { enabled: true, concurrency: 5, priority: 'fifo' },
    retry: { attempts: 3, backoff: 'exponential', baseDelay: 500 }, // see retries.md
  },
  openapi: { mode: 'runtime' },
})

// Firing 50 calls only ever runs 5 at a time; the rest wait in FIFO order.
await Promise.all(items.map((item) => api.items.sync(item)))
```

Combine with [deduplication](./deduplication.md) so identical calls inside
that burst don't each consume a separate queue slot — dedup coalesces them
into one before the queue/network layer ever sees more than one request for
the same identity.

**See it live:** the example configures `http.queue.concurrency: 6` —
[`examples/react-vite/src/lib/api/api.config.ts`](../examples/react-vite/src/lib/api/api.config.ts).
Combined with deduplication, the Feature Lab's "Deduplication (6→1)" burst
demonstrates how concurrent traffic is managed.

## Advanced: standalone queue utility

```ts
import { createQueue } from '@developerehsan/api-client'

const queue = createQueue({ concurrency: 3, priority: 'fifo' })
await queue.add(() => doSomeWork(), { signal: controller.signal })
queue.size()   // tasks waiting, not yet started
queue.active() // tasks currently running
```

See the [API reference](./api-reference.md#standalone-utilities).

## Gotchas / troubleshooting

- **"Setting `priority: 'lifo'` didn't change which request finished first,
  only which one started next."** Correct — LIFO changes *dispatch order out
  of the waiting list*, not execution speed. Once running, requests still race
  independently; LIFO only affects which queued item is pulled next when a
  slot frees up.
- **"My per-module concurrency setting seems to affect other modules too."**
  Expected — there's one shared queue for the whole client, not one per
  module. Use per-call `{ queue: false }` for one-off exceptions instead.
- **"Queue never processes my request."** Check `http.queue.enabled` isn't
  `false` at any layer and that you didn't pass an already-aborted `signal`.
- Related: [deduplication](./deduplication.md) for the layer checked right
  after the queue in the pipeline, [retries](./retries.md) for what happens
  when a queued-and-dispatched request fails.
