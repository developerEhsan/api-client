# TanStack Query — React / Vue / Solid

[← Docs index](./README.md)

Install `@developerehsan/api-client-query` and the TanStack adapter for your
framework, then build an integration from your client + a descriptor map (the
generated `generatedModules`, or a hand-written one).

```bash
pnpm add @developerehsan/api-client-query @tanstack/react-query   # or vue-/solid-query
```

```ts
// query.ts
import { createQueryIntegration } from '@developerehsan/api-client-query/react'  // or /vue, /solid
import { generatedModules } from './generated/api.modules'
import { api } from './api'

export const q = createQueryIntegration(api, { modules: generatedModules })
```

Per module you get `queryOptions`, `mutationOptions`, and (for paginated GETs)
`infiniteQueryOptions` factories that plug straight into the hooks.

## React

```tsx
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

**See it live:** the React example drives an infinite product list + a create
mutation (which invalidates and refetches) through the **same** typed client —
[`examples/react-vite/src/features/TanstackDemo.tsx`](../examples/react-vite/src/features/TanstackDemo.tsx),
integration in [`query.ts`](../examples/react-vite/src/lib/api/query.ts).

## Vue

```ts
import { createQueryIntegration } from '@developerehsan/api-client-query/vue'
```

```vue
<script setup lang="ts">
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { q } from './query'

const queryClient = useQueryClient()
const { data, isLoading } = useQuery(q.users.queryOptions.list({ page: 1 }))
const create = useMutation(q.users.mutationOptions.create({
  onSuccess: () => q.users.invalidateQueries(queryClient),
}))
</script>
```

> With Vue Query you typically pass reactive params inside a `computed`:
> `computed(() => q.users.queryOptions.list({ page: page.value }))`.

## Solid

```tsx
import { createQueryIntegration } from '@developerehsan/api-client-query/solid'
```

```tsx
import { useQuery, useMutation } from '@tanstack/solid-query'
import { q } from './query'

function Users() {
  const query = useQuery(() => q.users.queryOptions.list({ page: 1 }))
  const create = useMutation(() => q.users.mutationOptions.create())
  return null
}
```

> Solid Query expects a **function** returning the options object, so wrap the
> factory call in an arrow.

## Query keys & behavior

- Keys are stable and hierarchical: `['developerEhsan', module, method, params]`.
- Passing `null`/`undefined` params to a query that needs them sets
  `enabled: false` automatically (dependent queries).
- The `AbortSignal` from TanStack is forwarded into the pipeline, so unmounting
  cancels the request.

## Infinite queries & pagination

Any GET the codegen marks paginated gets an `infiniteQueryOptions.<method>`
factory. Configure how pages advance with `pageParamName` + `getNextPageParam` —
e.g. for an offset/`skip` API like DummyJSON:

```ts
export const q = createQueryIntegration(api, {
  modules: generatedModules,
  pageParamName: 'skip',
  getNextPageParam: (last: { skip: number; limit: number; total: number }) => {
    const next = last.skip + last.limit
    return next < last.total ? next : undefined
  },
})
```

This exact config is used in [`query.ts`](../examples/react-vite/src/lib/api/query.ts).

## Over the SSR RPC bridge

Point the integration at the **browser** RPC client plus the paths-stripped
`rpcModules` descriptor (`api.rpc.ts`) to get the same hooks client-side without
leaking backend paths:

```ts
import { createQueryIntegration } from '@developerehsan/api-client-query/react'
import { api } from './rpc-client'
import { rpcModules } from './types/generated/api.rpc' // no backend paths
export const q = createQueryIntegration(api, { modules: rpcModules })
```

See [SSR RPC bridge](./ssr-rpc-bridge.md) and the
[`examples/nextjs`](../examples/nextjs) app.
</content>
