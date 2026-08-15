# Caching & DX Overhaul — Plan Index

Status: **proposed, not yet implemented**. This directory is the single source
of truth for a multi-part improvement effort covering response caching
(client + server/SSR), type-safety without codegen, refresh-token DX, and a
few smaller developer-experience gaps. It exists so any agent (human or AI)
can pick up **one file** and implement that piece correctly without needing
the rest of this conversation's context.

## How to use this plan

Each numbered file below is self-contained: problem statement, current-state
code references (file:line, accurate as of the commit this was written
against — re-verify before trusting a line number), target design, exact
type/interface changes, security constraints, and a test checklist. Work
one file at a time, in the priority order listed. Do not start file `03`
before `01` and `02` are merged — `03` assumes the tag index from `01` exists.

If a file's code references no longer match the codebase (line numbers
drift), that's expected over time — re-locate the referenced symbol by name
and proceed; the design intent is what matters, not the exact line.

## Priority order

1. [`01-tag-based-invalidation.md`](./01-tag-based-invalidation.md) — fixes stale GET after mutation; fixes same-VM two-user cache mismatch.
2. [`02-cross-instance-invalidation.md`](./02-cross-instance-invalidation.md) — fixes stale cache across multiple server processes/VMs (Redis pub/sub).
3. [`03-memory-aware-caching.md`](./03-memory-aware-caching.md) — fixes unbounded memory growth on constrained hosts.
4. [`04-typesafety-without-codegen.md`](./04-typesafety-without-codegen.md) — full type-safety without forcing codegen (naming correction inside: it's `createClient`/`createTypedClient`, not `createApiClient`).
5. [`05-refresh-token-dx.md`](./05-refresh-token-dx.md) — callback-based token refresh alternative to the endpoint-only flow; pluggable token storage.
6. [`06-server-only-boundary.md`](./06-server-only-boundary.md) — throw-on-browser-import guard for server-only entry points.
7. [`07-adapter-specific-cache-config.md`](./07-adapter-specific-cache-config.md) — Redis/IndexedDB get their own config shapes instead of one generic one.
8. [`08-additional-hardening.md`](./08-additional-hardening.md) — grab-bag of smaller, independent improvements (negative caching, ETag support, metrics hooks, circuit breaker, at-rest encryption, logout-triggered clear, schema-version cache busting, dry-run invalidation).
9. [`09-filesystem-cache-store.md`](./09-filesystem-cache-store.md) — disk-backed `PersistentCacheStore` adapter (Next.js data-cache / nginx `proxy_cache` precedent) for long-running server instances that want to trade RAM for disk; not for serverless/edge.
10. [`10-custom-cache-key-composition.md`](./10-custom-cache-key-composition.md) — `cacheKeyParts` lets a developer add extra key dimensions (e.g. a viewed workspace/user id) on top of the built-in tenant/auth scoping, without the unsafe full-override `keyResolver` has to accept today.
11. [`11-docs-jsdoc-examples-overhaul.md`](./11-docs-jsdoc-examples-overhaul.md) — independent of 01-10 (can run in parallel): JSDoc `@example` coverage on every public export/config field, example apps demonstrating every currently-undemonstrated feature (queue, multi-tenancy, streaming, cache-persistence, rate-limiting, environments, timeouts, manual-types, testing, codegen), and a depth pass on the 6 thinnest docs pages.

## Already implemented — do not rebuild

- **Per-call cache TTL.** `PerCallConfig.cache.ttl` (`types/config.types.ts:640-645`)
  already merges in at the highest precedence in
  `factory/mergeModuleConfig.ts:126-131` (`deepMerge(..., perCall?.cache ?? {})`).
  `api.module.method(args, { cache: { ttl: 5000 } })` already caches that one
  call for 5s regardless of global/module TTL. If a real repro shows this not
  taking effect, treat it as a bug in the existing merge/read path, not a
  missing feature — investigate `createClient.ts:712` (`resolved.cache.ttl`)
  and the merge order before adding new API surface for this.

## Non-negotiable security constraints (apply to every file in this plan)

These come from the existing design (`packages/core/src/cache-stores/store.types.ts:7-10`,
`packages/core/src/utilities/cache.ts:113-128`, `SECURITY.md`) and **must not
regress** while implementing any part of this plan:

1. **Cross-tenant / cross-user isolation stays intact.** `computeCacheKey`
   (`packages/core/src/utilities/cache.ts:119-128`) scopes every cache key by
   `tenantId` + `authFingerprint`. Any new indexing structure (tag index,
   pub/sub channel, etc.) may **look up across scopes to invalidate**, but
   must **never let one scope read another scope's cached data**. Invalidation
   is allowed to be global; data access is not.
2. **Never persist or transmit raw auth material.** Cache entries, Redis
   pub/sub payloads, and any new metrics/telemetry hook must carry opaque
   keys/tags/hashes only — never tokens, cookies, or raw `Authorization`
   headers. `authFingerprint` is already a derived, non-reversible value; keep
   it that way.
3. **Fail closed, not open.** The existing pattern (`createClient.ts:691-696`:
   if the auth-fingerprint getter throws, caching and dedup are disabled for
   that request rather than falling back to an unscoped key) is the model.
   Any new feature that can't safely resolve its scoping/config must disable
   itself for that request, not guess.
4. **New `PersistentCacheStore` capabilities are additive, not breaking.**
   Existing custom implementations of the `PersistentCacheStore` interface
   (`cache-stores/store.types.ts:19-24`) must keep working unmodified. New
   capabilities (e.g. pub/sub) are optional, feature-detected extensions —
   never new required interface methods.
5. **The browser bundle stays clean.** `scripts/check-browser-bundle.mjs`
   greps `packages/core/dist/browser.js` for `axios`, `openapi.json`,
   `createRpcHandler`. Anything added under this plan that touches
   Node-only APIs (`process.memoryUsage()`, Redis clients, disk I/O) must be
   feature-detected the way `createIndexedDbStore` feature-detects
   `indexedDB` (`cache-stores/index.ts:69`), and must not be reachable from
   the `/browser` subpath export. Re-run the bundle check after any change
   touching `cache-stores/`, `server/`, or `browser/`.
6. **`TypedModulesConfig` stays a loose open-index type.** Per `CLAUDE.md`:
   if a change to `createTypedClient.ts` or related generics turns this into
   an intersection, TS silently drops user overrides. Any type change in
   file `04` must be verified against the existing "custom methods and
   return types always win" behavior.
7. **No silent behavior change for existing users.** Every new config field
   defaults to the current behavior (e.g. `crossInstance` defaults to `false`
   unless a Redis store is detected; `maxSizeBytes` unset means today's
   count-based `maxSize` still governs). This is a library — a minor/patch
   bump must not change what already-deployed apps do.

## What "done" looks like for this plan

- All 8 files implemented, each with its own test file (see per-file test
  checklists) and a docs/*.md update (this plan does not replace user-facing
  docs — `docs/caching.md`, `docs/cache-persistence.md`, `docs/authentication.md`,
  `docs/multi-tenancy.md` still need updating once each feature lands).
- `pnpm build && pnpm typecheck && pnpm test` clean across all packages.
- `node scripts/check-browser-bundle.mjs` passes.
- A CHANGELOG/changeset entry per shipped feature (this repo uses Changesets —
  see `.changeset/README.md`).
