# 04 — Full type-safety without codegen

## Naming note (read first)

The user-facing complaint referred to "`createApiClient`" vs
"`createTypeSafeApiClient`". Neither name exists literally in the codebase.
The actual two entry points are:

- **`createClient(config: GlobalConfig): ApiClient`** —
  `packages/core/src/factory/createClient.ts:286`. No generics. Every
  module/method access on the returned proxy types as `unknown` via the
  `ApiClient` interface's open index signature
  (`[module: string]: unknown`, `createClient.ts:131`) — this is the
  "not fully type-safe" factory the user means.
- **`createTypedClient<Ops>()(config, descriptors): TypedApiClient<Ops, Desc, Mods>`** —
  `packages/core/src/factory/createTypedClient.ts:451`. Curried because,
  per the existing doc comment (lines 428-430), TS can't partially infer a
  single call — `Ops` (the `OperationsMap`) must be supplied explicitly,
  `Desc`/`Mods` are inferred from the second call. `Ops` is not a package
  type — it's **emitted by codegen** (`src/codegen/typeEmitter.ts:153`,
  `emitOperationsMap`) into the consumer's generated `api.types.ts`. This is
  the factory that requires codegen output today.

The rest of this file uses these real names.

## Problem

`createTypedClient` gives full type-safety but its `Ops` generic is, in
practice, only ever populated by codegen's generated `OperationsMap`.
Nothing stops a developer from hand-writing an interface shaped like an
`OperationsMap` and passing it manually — but this isn't documented or
designed as a first-class path, so developers who don't want codegen (small
project, no OpenAPI spec, hand-rolled backend) fall back to `createClient`
and lose all type-safety, then hand-write types for every call site anyway.
The DX gap is real even though the underlying mechanism (a generic `Ops`
parameter) already technically permits this — it's a documentation and
ergonomics gap, not fundamentally a missing type-system capability.

## Current state (reference)

- `OperationsMap` shape (from `typeEmitter.ts:153`, `emitOperationsMap`) —
  need to read this function to document the exact interface shape
  (per-operation input/response types keyed by `operationId`) so hand-authors
  know exactly what to write. **Action for whoever implements this file:**
  read `emitOperationsMap` fully and extract the literal shape into the new
  doc/example below — don't guess it from this plan alone.
- `TypedModulesConfig<Ops, Desc>` — `createTypedClient.ts:200-204` — must stay
  a loose, open-index type (see the reasoning comment at lines 191-198,
  echoed in `CLAUDE.md`) so that per-module config keys aren't "stolen" from
  inference. This constraint applies equally whether `Ops` comes from
  codegen or is hand-written — nothing in this file changes it.
- `createModuleDefiner<Ops, Mods>()` — `createTypedClient.ts:331` — the
  opt-in mechanism for per-method name/input autocomplete (workaround for a
  TS inference limit, documented at lines 275-293). Already generic over
  `Ops`, already works with a hand-written `Ops` today — this is more of a
  discoverability gap than a code gap.
- `GeneratedModuleMap`/`GeneratedMethodDescriptor` — the `Desc` shape,
  currently produced by codegen's `api.modules.ts` output
  (`as const` value, per `CLAUDE.md`).

## Design

This is primarily a **documentation + one small ergonomic helper** change,
not a type-system overhaul — the generic machinery already supports a
hand-written `Ops`. Two concrete additions:

### 1. A `defineOperations` (or similarly named) type-only helper

Purely for DX/discoverability — a thin identity function so hand-authoring
`Ops` looks and feels like a first-class workflow instead of "reverse-engineer
what codegen would have produced":

```ts
// src/index.ts — new export
/**
 * Identity helper for hand-authoring an `OperationsMap` without codegen.
 * Purely a type-checking aid — returns its argument unchanged. Use this to
 * get the same IDE feedback codegen's generated `api.types.ts` would give,
 * without running codegen.
 *
 * @example
 * ```ts
 * interface MyOps {
 *   getUser: { input: { id: string }; response: User };
 *   updateUser: { input: { id: string; body: Partial<User> }; response: User };
 * }
 * const api = createTypedClient<MyOps>()(config, myModuleDescriptors);
 * ```
 */
export function defineOperations<T extends OperationsMapShape>(): T {
  return {} as T; // type-only marker; not meant to be called at runtime with a value
}
```

(Exact utility of a runtime function here is marginal since `Ops` is already
just a type parameter — implementation should evaluate whether this
adds real value over "just write the interface and pass it as `<MyOps>`"
documented clearly, versus being unnecessary ceremony. If it doesn't earn
its keep, skip it and go straight to the docs fix below — don't ship an
API surface nobody needs.)

### 2. A worked, first-class "no codegen" doc + example (the actual fix)

The highest-value part of this file is `docs/codegen.md` or a new
`docs/manual-types.md` gaining a complete, copy-pasteable example showing:

```ts
import { createTypedClient, createModuleDefiner, defineModule } from '@developerehsan/api-client';

// 1. Hand-write the operations map — same shape codegen would emit.
interface MyOperations {
  getUser: { input: { id: string }; response: { id: string; name: string } };
  updateUser: { input: { id: string; body: { name?: string } }; response: { id: string; name: string } };
}

// 2. Hand-write module descriptors (or use defineModule per method).
const modules = {
  users: defineModule({
    getUser: { method: 'GET', path: '/users/:id' },
    updateUser: { method: 'PATCH', path: '/users/:id' },
  }),
} as const;

// 3. Full type-safety, zero codegen.
const definer = createModuleDefiner<MyOperations, typeof modules>();
const api = createTypedClient<MyOperations>()(
  { baseURL: 'https://api.example.com' },
  modules,
);

const user = await api.users.getUser({ id: '1' }); // fully typed, no `unknown`
```

This example must be **tested**, not just written — add it as an actual
`.test.ts` (or a `.test-d.ts` type-only test if the repo has a convention
for those; check `packages/core` for existing `expectType`/`tsd`-style tests
before introducing a new pattern) so it doesn't silently bit-rot when
`createTypedClient`'s generics change.

### 3. Only if the above proves insufficient: a convenience wrapper

If, after writing the doc example, the ceremony still feels heavier than it
should (extra `as const`, curried call, `createModuleDefiner` as a separate
step), consider a single convenience export that bundles the common case:

```ts
export function createManualTypedClient<Ops, Desc extends GeneratedModuleMap>(
  config: Omit<GlobalConfig, 'modules'>,
  descriptors: Desc,
): TypedApiClient<Ops, Desc, TypedModulesConfig<Ops, Desc>> {
  return createTypedClient<Ops>()(config, descriptors);
}
```

This is a strict subset of `createTypedClient`'s capability (no custom
`modules` override) — treat it as optional sugar, not a required deliverable.
**Do not build this before confirming, via the doc example above, that
`createTypedClient` genuinely can't already do this ergonomically** — adding
a redundant entry point that does the same thing as an existing one, worse,
is the kind of unnecessary abstraction this codebase's own conventions
(`CLAUDE.md`, general engineering guidance) argue against.

## Constraints specific to this file

- **Must not touch `TypedModulesConfig`'s loose open-index shape.** This is
  called out explicitly in `CLAUDE.md` as a known TS footgun — the type
  becoming an intersection instead of a constraint silently drops user
  overrides. Any change in this file must be typechecked against the
  existing "custom methods and return types always win" test coverage
  (find and re-run whatever test currently guards this — likely in
  `createTypedClient.test.ts` or `mergeModuleConfig`-adjacent tests) before
  and after the change, to prove no regression.
- **`Ops` shape must exactly match what codegen emits**, or the "manual and
  generated types are interchangeable" promise breaks and a project that
  starts manual and later adopts codegen (or vice versa) gets surprise type
  errors. Whoever implements this must read `emitOperationsMap`
  (`typeEmitter.ts:153`) in full and mirror its exact output shape in the
  manual-authoring docs/example — do not approximate it.

## Tests to add

- Type-only test (whatever convention the repo uses — check for existing
  `.test-d.ts` files before inventing one) proving a hand-written `Ops`
  interface produces the same typed method signatures as a codegen-emitted
  one, for at least one operation with path params + body + typed response.
- Regression test re-confirming `TypedModulesConfig` override precedence
  (module config wins over generated) still passes — this is really just
  "re-run the existing test," called out here so it's not skipped.

## Docs to update after shipping

New `docs/manual-types.md` (or a substantial new section in
`docs/codegen.md` titled "Not using codegen?"), linked from
`docs/getting-started.md` as an equally first-class path, not a fallback.
