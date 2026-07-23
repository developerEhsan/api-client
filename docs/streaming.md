# Streaming

[← Docs index](./README.md)

`ctx.stream(spec, options?)` returns an **`AsyncIterable`** for streamed
responses — NDJSON, Server-Sent Events, or raw bytes. Unlike `ctx.request`,
streaming intentionally **bypasses** cache, dedup, and response validation
(meaningless for a stream).

```ts
defineModule({
  methods: {
    // Stream newline-delimited JSON rows
    tail: async function* (ctx) {
      for await (const row of ctx.stream(
        { method: 'GET', path: '/logs/stream' },
        { mode: 'ndjson' },
      )) {
        yield row as LogRow
      }
    },

    // Stream Server-Sent Events
    subscribe: async function* (ctx, channel: string) {
      for await (const event of ctx.stream(
        { method: 'GET', path: '/events/{channel}', pathParams: { channel } },
        { mode: 'sse' },
      )) {
        yield event   // { event?, data, id?, retry? }
      }
    },
  },
})
```

## Options

```ts
interface StreamOptions {
  mode?: 'ndjson' | 'sse' | 'raw'   // how to decode the byte stream
  signal?: AbortSignal              // aborting rejects the iterator with an AbortError
}
```

- `'ndjson'` → yields each parsed JSON line.
- `'sse'` → yields `SseEvent` objects (`{ event?, data, id?, retry? }`).
- `'raw'` → yields `Uint8Array` byte chunks.

## Standalone parsers

The parsing helpers are exported for use with your own readers:

```ts
import { parseNdjson, parseSse } from '@developerehsan/api-client'
```

## Consuming a stream

```ts
for await (const row of api.logs.tail()) {
  console.log(row)
}
```

## Notes

- Client-side streaming works with both the `fetch` and Axios adapters.
- Streaming **through the SSR RPC bridge** is a follow-up (Server Actions can't
  stream); use a route handler for streamed endpoints today. See the
  [roadmap](../README.md#28-roadmap).
</content>
