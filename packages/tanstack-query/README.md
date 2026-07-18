# @developerehsan/api-client-query

[![npm version](https://img.shields.io/npm/v/@developerehsan/api-client-query.svg)](https://www.npmjs.com/package/@developerehsan/api-client-query)
[![npm downloads](https://img.shields.io/npm/dm/@developerehsan/api-client-query.svg)](https://www.npmjs.com/package/@developerehsan/api-client-query)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/developerEhsan/api-client/blob/master/LICENSE)
[![Types](https://img.shields.io/npm/types/@developerehsan/api-client-query.svg)](https://www.npmjs.com/package/@developerehsan/api-client-query)

> Framework-agnostic **TanStack Query v5** integration for
> [`@developerehsan/api-client`](https://www.npmjs.com/package/@developerehsan/api-client) —
> typed `queryOptions`, `mutationOptions`, and `infiniteQueryOptions` factories
> for **React**, **Vue**, and **Solid**, generated straight from your API modules.

Stable, hierarchical query keys; automatic `enabled: false` for dependent queries;
`AbortSignal` forwarded into the request pipeline so unmounting cancels the request.

## Installation

Install alongside your client and the TanStack adapter for your framework:

```bash
# React
pnpm add @developerehsan/api-client-query @tanstack/react-query

# Vue
pnpm add @developerehsan/api-client-query @tanstack/vue-query

# Solid
pnpm add @developerehsan/api-client-query @tanstack/solid-query
```

## Usage

Build an integration from your client + a descriptor map (the codegen-generated
`generatedModules`, or a hand-written one). Import from the entry for your
framework: `/react`, `/vue`, or `/solid`.

```ts
// query.ts
import { createQueryIntegration } from '@developerehsan/api-client-query/react'
import { generatedModules } from './generated/api.modules'
import { api } from './api'

export const q = createQueryIntegration(api, { modules: generatedModules })
```

```tsx
// React
import { useQuery, useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { q } from './query'

function UsersPage() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery(q.users.queryOptions.list({ page: 1 }))

  const create = useMutation(
    q.users.mutationOptions.create({
      onSuccess: () => q.users.invalidateQueries(queryClient),
    }),
  )

  const infinite = useInfiniteQuery(q.users.infiniteQueryOptions.list({ limit: 20 }))
  return null
}
```

Vue (`/vue`) and Solid (`/solid`) expose the same factories — plug the option
objects into `@tanstack/vue-query` / `@tanstack/solid-query` respectively (with
Solid, wrap the call in an arrow: `useQuery(() => q.users.queryOptions.list(...))`).

### Query keys

Keys are stable and hierarchical: `['developerEhsan', module, method, params]`.
Passing `null` / `undefined` params to a query that needs them sets
`enabled: false` automatically (dependent queries).

### Infinite queries & pagination

Any GET the codegen marks paginated (a `page` / `limit` / `offset` / `cursor`
query param) gets an `infiniteQueryOptions.<method>` factory. Configure how pages
advance with `pageParamName` + `getNextPageParam` — e.g. for an offset/`skip`
API like DummyJSON:

```ts
export const q = createQueryIntegration(api, {
  modules: generatedModules,
  pageParamName: 'skip',
  getNextPageParam: (last: { skip: number; limit: number; total: number }) => {
    const next = last.skip + last.limit
    return next < last.total ? next : undefined
  },
})

// then:
const list = useInfiniteQuery(q.products.infiniteQueryOptions.listProducts({ limit: 10 }))
list.fetchNextPage()
```

### Over the SSR RPC bridge

Point the integration at the **browser** RPC client plus the paths-stripped
`rpcModules` descriptor (`api.rpc.ts`) to get the same hooks client-side without
leaking backend paths — see the `examples/nextjs` app.

## Documentation

📖 Full React / Vue / Solid guides, SSR prefetch + hydration, and the runtime
library reference live in the
**[project README on GitHub](https://github.com/developerEhsan/api-client#readme)**.

## License

[MIT](https://github.com/developerEhsan/api-client/blob/master/LICENSE) © EHSAN
