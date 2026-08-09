# Full type-safety without codegen

[← Docs index](./README.md)

`createTypedClient<Ops>()(config, descriptors)` gives full end-to-end
type-safety — but `Ops` doesn't have to come from codegen. It's a plain type
parameter; hand-write it and you get exactly the same inference codegen's
generated `api.types.ts` would give you, with zero build step. This is a
first-class path, not a fallback for when codegen "doesn't apply yet."

## The shape `Ops` must have

Codegen emits one entry per `operationId` shaped like this (from
`src/codegen/typeEmitter.ts`'s `emitOperationEntry`):

```ts
interface OperationsMap {
  [operationId: string]: {
    params: Record<string, string | number>; // path params
    query: Record<string, unknown>;          // query params
    body: unknown;                            // request body, or `never` if none
    response: unknown;                        // success response body
  };
}
```

Every field is present (codegen always emits all four; hand-authored `Ops`
can omit fields it doesn't need — `createTypedClient`'s generics fall back to
loose defaults for anything missing). Mirror this shape exactly so a project
that starts manual and later adopts codegen (or vice versa) gets no surprise
type errors.

## Worked example

```ts
import { createTypedClient, createModuleDefiner } from '@developerehsan/api-client'

// 1. Hand-write the operations map — same shape codegen would emit.
interface MyOperations {
  getUser: { params: { id: string }; response: { id: string; name: string } };
  updateUser: {
    params: { id: string };
    body: { name?: string };
    response: { id: string; name: string };
  };
}

// 2. Hand-write module descriptors — same shape as generated `api.modules.ts`.
const descriptors = {
  users: {
    getUser: { method: 'GET', path: '/users/{id}', operationId: 'getUser' },
    updateUser: { method: 'PATCH', path: '/users/{id}', operationId: 'updateUser' },
  },
} as const

// 3. Full type-safety, zero codegen.
const api = createTypedClient<MyOperations>()(
  { baseURL: 'https://api.example.com', openapi: { mode: 'runtime' } },
  descriptors,
)

const user = await api.users.getUser({ id: '1' })            // typed, no `unknown`
await api.users.updateUser({ id: '1', body: { name: 'Rex' } })
```

That's the whole recipe — no extra helper needed. `createTypedClient`'s
curried call (`<MyOperations>()(config, descriptors)`) exists because
TypeScript can't partially infer a single call, not because of anything
codegen-specific; it's exactly as ergonomic for a hand-written `Ops`.

## Method-name autocomplete on a known module

`config.modules` is deliberately loose (an open index type — see
["Config is the final source of truth"](#config-is-the-final-source-of-truth)
further down) so overrides always win. That means `config.modules.users.methods`
doesn't autocomplete method *names* by default. Opt into
`createModuleDefiner` for that, same as with generated descriptors:

```ts
import { createModuleDefiner } from '@developerehsan/api-client'

const defineModule = createModuleDefiner<MyOperations, typeof descriptors>()

const users = defineModule('users', {
  methods: {
    // `input.id` is typed from MyOperations['getUser']; return shape is free
    getUser: async (ctx, input) => {
      const res = await ctx.request({ method: 'GET', path: '/users/{id}', pathParams: input })
      return res.data
    },
  },
})

const api = createTypedClient<MyOperations>()(
  { baseURL: 'https://api.example.com', openapi: { mode: 'runtime' }, modules: { users } },
  descriptors,
)
```

## Config is the final source of truth

Whether `Ops`/descriptors are hand-written or generated, `config.modules`
merges over them **per method** — a custom method's return type always wins,
and the type stays intact after a regenerate. See
[module config = source of truth](./modules-and-methods.md) for the full
override semantics; nothing about that changes when you skip codegen.

## When to reach for codegen anyway

Hand-writing `Ops` is fine for a handful of operations. Once you have a real
OpenAPI spec, [codegen](./codegen.md) keeps `Ops` and the descriptor map in
sync with the backend automatically — switching later costs nothing, since
both paths produce the exact same shape.
