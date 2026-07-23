# Testing your code

[← Docs index](./README.md)

Use the built-in mock client — no real network, full pipeline.

```ts
import { createMockClient } from '@developerehsan/api-client/testing'
import { defineModule } from '@developerehsan/api-client'

const { api, mock } = createMockClient({
  modules: {
    users: defineModule({
      methods: {
        get: async (ctx, id: string) =>
          (await ctx.request({ method: 'GET', path: '/users/{id}', pathParams: { id } })).data,
      },
    }),
  },
})

// Register responses (by method + URL substring, or a function responder):
mock.on('GET', '/users/1', { data: { id: '1', name: 'Ada' } })
mock.on('GET', '/users/', (req) => ({ status: 404, data: { message: 'not found' } }))

// Act + assert:
const user = await api.users.get('1')
expect(user).toEqual({ id: '1', name: 'Ada' })
expect(mock.callsTo('GET', '/users/1')).toHaveLength(1)
```

- `createMockClient` defaults to **instant retries** (no delays) for fast tests.
- The full pipeline still runs — cache, dedup, retry, auth, validation — so you
  test *your* code against real client behavior, just without a network.
- You can also use `createMockAdapter()` directly with a real `createClient` if
  you want to control the adapter layer only.

## Responders

A responder is either a static `{ status?, data, headers? }` object or a function
`(req) => response`. Functions let you assert on the request or vary the response
by input:

```ts
mock.on('POST', '/users', (req) => ({ status: 201, data: { id: 'u1', ...req.body } }))
```

## Assertions

```ts
mock.callsTo('GET', '/users/1')   // array of matching recorded requests
mock.reset()                       // clear registered responders + recorded calls
```

## Testing the library itself

The repository's own suite is a good reference for patterns — e.g. the RPC
security threat cases in `packages/core/src/server/rpc.test.ts`. Run the suite
with `pnpm test` (or `pnpm --filter @developerehsan/api-client test`).
</content>
