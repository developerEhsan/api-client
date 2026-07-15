# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run from the repo root (pnpm workspaces; Node 22, pnpm 10):

```bash
pnpm build       # tsup build, all packages
pnpm test        # vitest run, all packages
pnpm typecheck   # tsc --noEmit, all packages
```

Scope to one package with `--filter`:

```bash
pnpm --filter @developerehsan/api-client test          # core only
pnpm --filter @developerehsan/api-client test:watch    # watch mode
pnpm --filter @developerehsan/api-client build          # rebuild dist (see note below)
```

Run a single test file / a single test by name (vitest):

```bash
pnpm --filter @developerehsan/api-client exec vitest run src/server/rpc.test.ts
pnpm --filter @developerehsan/api-client exec vitest run -t "S1: rejects a non-exposed"
```

**Critical build ordering:** the examples and the `tanstack-query` package consume `@developerehsan/api-client` through its **built `dist/`** (types included), not its source. After editing `packages/core/src`, run its `build` before typechecking `packages/tanstack-query` or `examples/*`, or you'll see stale-type errors (e.g. a descriptor field "missing" that you already added). There is no root `lint` implementation — only the Next.js example has ESLint.

## Architecture

A monorepo (`packages/*`, `examples/*`) implementing a typed, modular, universal API client factory. Three published packages:

- **`packages/core`** → `@developerehsan/api-client` — the runtime client + OpenAPI codegen.
- **`packages/cli`** → thin `bin` wrapper (`developerEhsan-api-client`) over core's `./codegen` export (`generate`/`validate`/`diff`).
- **`packages/tanstack-query`** → `@developerehsan/api-client-query` — framework-agnostic TanStack Query integration with `./react` `./vue` `./solid` entries.

### The request pipeline (the heart of the client)

`createClient` (`packages/core/src/factory/createClient.ts`) builds an inline `run: RequestRunner` closure (~line 325) that every call flows through in this order: **queue → dedup → cache → auth → dispatch(retry) → validate → cache write-through**. Cache is checked before queue/dedup (concurrent misses still coalesce via dedup). This is the authoritative pipeline — note a separate `http/pipeline.ts` exists but is an unused parallel impl. The single network dispatch point is `adapter.send()`; the adapter is `fetch` or `axios`, chosen by `environment/` detection (edge downgrades axios→fetch).

### Two Proxy layers turn config into `api.module.method()`

- Outer client Proxy (`createClient.ts`) intercepts reserved members (`cache`, `config`, `setEnvironment`, `getSchema`, `on`, `off`) and otherwise dispatches to module objects.
- Inner module Proxy (`factory/createModuleProxy.ts`) builds callable methods from auto-descriptors + custom methods (custom wins), and refuses to look like a thenable (`then` → `undefined`).

### Config is the final source of truth (typed client)

`factory/createTypedClient.ts` is curried: `createTypedClient<OperationsMap>()(config, generatedModules)`. The user's `config.modules` merges **over** the generated modules **per-method** — custom methods and return types always win. `TypedModulesConfig` must stay a loose open-index type (constraint, not intersection) or TS "steals" the known module keys and silently drops overrides. Method-*name* autocomplete is only reliable via the opt-in `createModuleDefiner`/`defineModule` — a TS inference limit, not a bug.

### OpenAPI: build-time vs runtime

`openapi.json` is a **build-time input** for codegen (`src/codegen/`), which emits consumer artifacts: `api.types.ts` (`OperationsMap` type), `api.modules.ts` (`generatedModules` value, `as const`), `api.rpc.ts` (paths-stripped descriptor — see SSR bridge), and `api.schema.hash`. The spec is **never bundled** into the shipped client; when `openapi.mode !== 'codegen'`, it is fetched at runtime (background, non-blocking) to power response validation + drift detection.

### SSR RPC bridge (hides backend URL/paths/openapi from the browser)

Two extra subpath exports let a client component call `api.module.method()` while the real request runs server-side, so the network tab shows only a same-origin POST of `{module, method, args}`:

- `@developerehsan/api-client/server` (`src/server/`) — `createRpcHandler(api, { expose, ... })` is the single trust boundary (deny-by-default allowlist + input/error sanitization; see the `S#` threat cases in `src/server/rpc.test.ts`), plus `createNextRpcAction` (Server Action) and `createRpcRouteHandler` (generic route).
- `@developerehsan/api-client/browser` (`src/browser/`) — dependency-free `createRpcClient<Api>(transport)` proxy; `Api = typeof serverApi` is a type-only import (erased), so no backend detail ships. Errors rehydrate to real `ApiError`.

Runtime-safety invariant: the browser bundle must contain no backend host/paths/axios — verify by grepping `packages/core/dist/browser.js` and example `.next/static` chunks after a build.

### Runtime bundle split

`packages/core` ships runtime-specific bundles via conditional exports (`edge-light`/`node`/`browser`/`import`/`require`). tsup entries live in `packages/core/tsup.config.ts`; `axios`/`zod` are optional externals. Public exports are an explicit allow-list in `src/index.ts` — add new public symbols there.

### Stable contract

Keep `src/types/` and `src/errors/` as the stable contract that implementation files depend on. Never throw a bare `Error` from the pipeline — always an `ApiError` subclass (`NetworkError`/`TimeoutError`/`AuthError`/`SchemaError`/`ConfigurationError`).

## Examples

`examples/react-vite` (pure client-side) and `examples/nextjs` (SSR RPC bridge demo). **`examples/nextjs` uses a modified Next.js** — read `examples/nextjs/node_modules/next/dist/docs/` before writing Next-specific code (per its `AGENTS.md`). Regenerate an example's `types/generated/` by running core's codegen against its `lib/api/openapi.json`.
