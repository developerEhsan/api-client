# 11 — Docs, JSDoc & Example-App Overhaul

Status: **in progress**. Independent of files `01`-`10` — can run in parallel
with the caching plan. Grounded by a repo survey performed 2026-08-10;
re-verify counts before trusting them if this file is picked up much later.

Format: each step is small, has an explicit **Verify** command, and does not
depend on later steps. Do them in order within a Part; Parts A/B/C are
independent of each other and may run in parallel.

## Problem statement

1. **JSDoc coverage is inconsistent and thin on examples.** Of 130 exports
   from `packages/core/src/index.ts`, 109 have a JSDoc block but only 31
   include an `@example`. `config.types.ts` is worst: 79/127 fields have
   prose JSDoc, only 2 have `@example` (both on `RetryConfig`).
2. **Example apps under-demonstrate the feature set.** Not shown anywhere:
   concurrency-queue, multi-tenancy, streaming, cache-persistence,
   rpc-rate-limiting, environment switching, timeouts-and-cancellation,
   modules-beyond-http, manual-types, testing, live codegen run.
3. **Six docs pages are skeletons** relative to feature surface:
   `deduplication.md` (31 lines), `environments.md` (31),
   `concurrency-queue.md` (32), `rpc-rate-limiting.md` (46), `retries.md`
   (50), `hooks-and-events.md` (52).

## Non-goals

- No new features, no runtime API changes.
- No renaming/restructuring of `docs/*.md` files.

## Cross-cutting rule

Every new `@example`/snippet must be copy-paste runnable against the
**current** API — verify field/symbol names against the actual source file
at write time, never from memory of this plan or old docs.

---

## Part A — JSDoc pass

### Step A1 — Zero-JSDoc exports get a full JSDoc block + `@example`
Targets: `ClientEventListener`, `createFetchAdapter`
(`http/adapters/fetchAdapter.ts`), `createAuthManager`/`AuthManager`
(`auth/authManager.ts`), `AuthStrategyName` (`types/auth.types.ts`),
`createSchemaCache`/`SchemaCache` (`runtime/schemaCache.ts`),
`createSchemaLoader`/`SchemaLoader` (`runtime/schemaLoader.ts`),
`DriftPolicy` (`runtime/driftDetector.ts`), `ValidationResult`
(`codegen/schemaValidator.ts`), `ResponseType` (`types/http.types.ts`),
`ModuleMethods` (`types/module.types.ts`), `SchemaAST`
(`types/openapi.types.ts`), `DetectedEnvironment`/`PlatformCapabilities`
(`types/environment.types.ts`), `EmitModulesOptions`
(`codegen/moduleEmitter.ts`), plus whatever `http/streaming.ts` turns out to
be missing (`parseSse`, `parseNdjson`, `iterateBytes`, `iterateLines`,
`SseEvent` — unconfirmed by the initial survey, check first).
**Verify:** `pnpm --filter @developerehsan/api-client build` succeeds (JSDoc
syntax errors surface as TS parse errors in some setups, but the real check
is `pnpm --filter @developerehsan/api-client exec tsc --noEmit`) — zero new
errors vs. baseline.

### Step A2 — `config.types.ts` fields get `@example`
Every user-facing field in `ClientConfig`/`HttpConfig`/`QueueConfig`/
`ValidationConfig`/`OpenApiConfig`/`TenancyConfig`/`CancellationConfig`/
`DevConfig`/`LifecycleHooks`/`GlobalConfig`/`ModuleConfig`/`PerCallConfig`
gets a one-line `@example` (e.g. `{ cache: { ttl: 5000 } }`). Skip
`ResolvedRequestConfig`/`ResolvedConfigSnapshot`/internal literal shapes —
not user-facing.
**Verify:** `pnpm --filter @developerehsan/api-client exec tsc --noEmit`
clean; grep count of `@example` in `config.types.ts` increases from 2 to
match the field count touched (spot check: `grep -c '@example'
packages/core/src/types/config.types.ts`).

### Step A3 — `@see` cross-links
Every `@example` added in A1/A2 gets a trailing `@see` line pointing at the
relevant `docs/*.md` file as a full GitHub URL —
`{@link https://github.com/developerEhsan/api-client/blob/master/docs/<file>.md}`
(pinned to `master`, not a relative repo path) — so the link resolves
correctly from IDE hovers, generated `.d.ts` output, and npm's rendered
README/docs regardless of the reader's local checkout state. Mirrors
`packages/tanstack-query/src/core/createIntegration.ts`'s existing JSDoc
style, updated to the URL form.
**Verify:** `grep -rL '@see' <files touched in A1/A2>` returns empty (every
touched file has at least one `@see`).

### Step A4 — tanstack-query JSDoc
`core/types.ts` (24 blocks, 0 `@example`) gets one-liners; `moduleKey`/
`methodKey` get `@example` each.
**Verify:** `pnpm --filter @developerehsan/api-client-query exec tsc
--noEmit` clean.

### Step A5 — Full workspace check
**Verify:** `pnpm build && pnpm typecheck` clean at the repo root (rebuild
core first since tanstack-query/examples consume its `dist/`, per
`CLAUDE.md`'s build-ordering rule).

---

## Part B — Example-app feature completion

Each step adds one new, self-contained demo file plus a short header
comment linking to its `docs/*.md` page. One step = one file = independently
verifiable.

### Step B1 — `examples/react-vite/src/ConcurrencyQueueDemo.tsx`
`queue` config; visualize in-flight vs queued calls. Links to
`concurrency-queue.md`.
**Verify:** `pnpm --filter react-vite-example build` (or repo-appropriate
package name — confirm via `examples/react-vite/package.json` `name` field
first) succeeds; manually load the demo route/component in dev server and
confirm no console errors.

### Step B2 — `examples/react-vite/src/MultiTenancyDemo.tsx`
`tenancy` config, tenant switch, cache isolation. Links to
`multi-tenancy.md`.
**Verify:** same build + dev-server smoke check as B1.

### Step B3 — `examples/react-vite/src/StreamingDemo.tsx`
SSE or NDJSON via `http/streaming.ts` exports. Links to `streaming.md`.
**Verify:** same build + dev-server smoke check; confirm streamed chunks
actually render incrementally (not just on completion).

### Step B4 — `examples/react-vite/src/CachePersistenceDemo.tsx`
IndexedDB L2 store in-browser. Links to `cache-persistence.md`.
**Verify:** same build + dev-server smoke check; confirm cache survives a
page reload (IndexedDB persistence is the point of the demo).

### Step B5 — `examples/react-vite/src/TimeoutsCancellationDemo.tsx`
Abort in-flight request, per-call timeout. Links to
`timeouts-and-cancellation.md`.
**Verify:** same build + dev-server smoke check; trigger both an abort and
a timeout, confirm distinct error types surface (`ApiError` subclasses).

### Step B6 — `examples/react-vite/src/ManualTypesDemo.tsx`
`createModuleDefiner`/`defineModule` without codegen. Links to
`manual-types.md`.
**Verify:** same build + dev-server smoke check; confirm method-name
autocomplete actually works in the IDE for this file (the point of
`defineModule` per `CLAUDE.md`).

### Step B7 — Testing demo
A `*.test.tsx`/`*.test.ts` using the mock client from `testing.md`,
colocated in `examples/react-vite/src/`.
**Verify:** `pnpm --filter react-vite-example test` (confirm actual test
script name first) passes.

### Step B8 — `examples/nextjs` rate-limiting route
Route/page demonstrating `rpc-rate-limiting.md`'s config on
`createRpcHandler`, including what the client sees on a 429.
**Verify:** `pnpm --filter nextjs-example build` succeeds; manually hit the
route enough times to trigger the 429 and confirm client-side error
handling.

### Step B9 — `examples/nextjs` environment-switching demo
Edge vs Node route showing fetch/axios adapter downgrade. Links to
`environments.md`.
**Verify:** same Next.js build; confirm both routes actually exercise
different adapters (log or assert `getSchema()`/adapter identity, don't
just assume from route config).

### Step B10 — `examples/nextjs` live codegen run
Script or `package.json` command that runs codegen against
`lib/api/openapi.json` instead of only shipping pre-generated output;
document the command in the example's own README.
**Verify:** run the documented command from a clean checkout of
`examples/nextjs`, confirm it regenerates `types/generated/` matching what's
currently committed (no drift) or intentionally update the committed output
if it doesn't.

### Step B11 — Full example workspace check
**Verify:** `pnpm build && pnpm typecheck` clean at repo root after all of
B1-B10.

---

## Part C — Docs depth pass

Each step brings one thin page up to the shape of `cache-persistence.md`/
`authentication.md` (problem statement → config shape → 2-3 worked examples
→ gotchas/troubleshooting cross-link). One step = one file.

### Step C1 — `deduplication.md`
Add: custom dedup key example, per-call opt-out, interaction with cache
(verify actual pipeline order — queue → dedup → cache per `CLAUDE.md`, but
confirm against `createClient.ts`'s current `run` closure before writing,
since this plan's own README notes cache is checked before queue/dedup —
these two descriptions conflict, resolve by reading the code, not by
picking one).
**Verify:** re-read `packages/core/src/factory/createClient.ts`'s `run`
closure and quote the actual order in the doc; no invented behavior.

### Step C2 — `environments.md`
Add: `DetectedEnvironment`/`PlatformCapabilities` shape table,
edge-downgrade example, manual `setEnvironment` override example.
**Verify:** every field named in the table exists in
`types/environment.types.ts` (grep to confirm).

### Step C3 — `concurrency-queue.md`
Add: per-module vs global queue config example, ordering/priority behavior
if any, worked burst-throttling example.
**Verify:** ordering/priority claims match actual queue implementation
behavior — trace it in source, don't assert unverified behavior.

### Step C4 — `rpc-rate-limiting.md`
Add: full `createRpcHandler` config example with rate-limit option beside
`expose`, and client-visible behavior on a 429.
**Verify:** config field names match `server/` source exactly.

### Step C5 — `retries.md`
Add: backoff strategy table, retry-on-condition example, interaction with
`AbortSignal`/timeouts.
**Verify:** backoff formula described matches `RetryConfig`'s actual
implementation, not a generic assumption.

### Step C6 — `hooks-and-events.md`
Add: one worked example per `LifecycleHooks` field (confirm exact field
count/names in `config.types.ts` first — the survey said 8, re-verify).
**Verify:** every hook name in the doc exists verbatim in
`LifecycleHooks`.

---

## Final verification (run after all Parts complete)

1. `pnpm build` — clean, all packages.
2. `pnpm typecheck` — clean, all packages.
3. `pnpm test` — clean, all packages.
4. `node scripts/check-browser-bundle.mjs` — still passes (Part B may have
   touched browser-adjacent example code).
5. Grep sweep: `grep -rL '@example' packages/core/src/index.ts
   packages/core/src/server/index.ts packages/core/src/browser/index.ts
   packages/core/src/codegen/index.ts` — should list zero files, or only
   files where every individual export inside already has `@example`
   (grep-by-file is a coarse signal, spot check the actual exports too).
6. Manual smoke test of each new example demo in a running dev server (not
   just build success) — a build passing doesn't mean the feature actually
   renders/works.
7. Changeset entry added (`.changeset/README.md` convention) noting
   docs/DX-only change — JSDoc ships in `.d.ts` output so still worth one.

## What "done" looks like

- 100% of public exports across all 4 core subpaths + 3 tanstack-query
  barrels have JSDoc with ≥1 `@example`.
- Every user-facing `config.types.ts` field has an inline `@example`.
- Every feature listed in Part B has a corresponding example file,
  cross-linked to its doc page, and manually smoke-tested.
- The 6 thin docs pages match the depth pattern of `cache-persistence.md`.
- Final verification section above is fully green.
