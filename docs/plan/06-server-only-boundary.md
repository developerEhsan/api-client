# 06 — Server-only import boundary guard

## Problem

The SSR RPC bridge's entire security model (`SECURITY.md`, `CLAUDE.md`
"SSR RPC bridge" section) depends on backend host/paths/OpenAPI/axios never
reaching the browser. Today that's enforced two ways: (1) architecturally —
`/server` and `/browser` are separate subpath exports with different
contents, and (2) after the fact — `scripts/check-browser-bundle.mjs` greps
the **built** browser bundle in CI.

Both are correct but both are **discovered late**: a developer who
accidentally imports `@developerehsan/api-client/server` (or a
`defineModule`/config object meant to stay server-side) from a client
component finds out only when CI's grep fails, or worse, only in production
if that check is ever skipped. Next.js solves the equivalent problem for its
own `server-only` package with an **immediate, loud runtime throw** the
moment the module is evaluated in a browser context. This library should
offer the same, opt-in, at the points where a leak is possible.

## Current state (reference)

- `packages/core/src/server/index.ts:3` — doc comment: "Import this in a
  server-only module (Server Action, route handler)." No runtime enforcement
  today, purely documentation.
- `createRpcHandler`, `createNextRpcAction`, `createRpcRouteHandler` — all in
  `src/server/` — these are the highest-value places to add the guard, since
  they're the actual trust boundary per `CLAUDE.md`.
- `createModuleDefiner`/`defineModule` — used to declare modules, potentially
  including server-only ones (e.g. a module wrapping direct DB access) that
  must never be evaluated client-side.
- `scripts/check-browser-bundle.mjs` — existing build-time/CI enforcement,
  stays as the last-resort net; this file adds an earlier, dev-time net.

## Design

### 1. A small internal `assertServerOnly()` helper

```ts
// packages/core/src/utilities/serverOnly.ts
export function assertServerOnly(where: string): void {
  const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
  if (isBrowser) {
    throw new ConfigurationError(
      `${where} must not run in the browser. This exposes backend URLs/paths/` +
      `credentials that the SSR RPC bridge is designed to hide — see SECURITY.md. ` +
      `If you're seeing this from a bundler, check for an accidental client-side ` +
      `import of a server-only module.`
    );
  }
}
```

Reuses the existing `ConfigurationError` from `src/errors/` (per `CLAUDE.md`
"never throw a bare Error from the pipeline") — this throw happens outside
the request pipeline proper (at module-eval or call time), but staying
consistent with the one error-hierarchy convention is still correct and
keeps `instanceof ApiError` checks working uniformly for consumers.

### 2. Call it at both module-evaluation time and call time

- **Eval-time** (Next.js `server-only` style — catches the leak as early as
  the bundler evaluates the module, before any function is even called):
  add `assertServerOnly('@developerehsan/api-client/server')` at the top of
  `src/server/index.ts`, gated behind a config/env check (see opt-out below).
- **Call-time**, for finer-grained cases where a whole module can't
  reasonably assert at eval time (e.g. `defineModule` is also usable for
  legitimately-client-safe modules — only some are server-only): add an
  explicit per-definition flag instead of a blanket module-level throw.

```ts
// factory/createModuleDefiner.ts (or wherever defineModule lives)
interface DefineModuleOptions {
  // ...existing options
  /**
   * When true, calling ANY method on this module throws immediately if
   * evaluated/called in a browser context. Use for modules that wrap
   * server-only concerns (direct DB access, secrets, internal services).
   * @default false
   */
  serverOnly?: boolean;
}
```

Enforced inside the module proxy's call path
(`factory/createModuleProxy.ts`) — check once per module (not per call, for
performance) at module construction time when `serverOnly: true` is set.

### 3. `createRpcHandler`/`createNextRpcAction`/`createRpcRouteHandler` default to enforced

```ts
export interface RpcHandlerOptions {
  // ...existing (expose, etc.)
  /**
   * Throws immediately if this handler is constructed/invoked in a browser
   * context. This is the real trust boundary (see SECURITY.md) — leave this
   * on unless you have a specific, documented reason not to.
   * @default true
   */
  enforceServerOnly?: boolean;
}
```

Default **on** here specifically (unlike most new config in this plan which
defaults to "no behavior change") — this is a pure safety net with no
legitimate reason to construct an RPC handler in a browser, so defaulting to
enforced is the secure-by-default choice and does not change behavior for
any correctly-configured existing app (only for one that was already
accidentally broken, where throwing early is strictly better than the
silent data leak it was risking).

### 4. Escape hatch, explicit and loud

Some test setups (jsdom-based unit tests importing server code) legitimately
need to bypass this. Provide a single documented override, not a config
maze:

```ts
enforceServerOnly: false // explicit opt-out, e.g. for jsdom test environments
```

Never auto-detect "this looks like a test" — that's fragile and exactly the
kind of implicit behavior that leads to the guard silently not firing when
it matters. Require the explicit `false`.

## Security constraints specific to this file

- This is a **defense-in-depth / DX** feature, not a replacement for
  `scripts/check-browser-bundle.mjs`. A determined bundler misconfiguration
  could theoretically strip the check (e.g. dead-code elimination assuming
  `window` is always defined in some exotic build target) — the CI bundle
  grep remains the authoritative last line of defense and must not be
  removed or weakened when this ships.
  ships.
- The thrown error message must **not** itself leak anything sensitive
  (e.g. don't interpolate the actual `baseURL` or backend paths into the
  error text) — keep it generic, pointing to SECURITY.md instead of
  echoing the config that would have leaked.
- `window.document` check (not just `typeof window`) avoids false positives
  in non-browser environments that happen to polyfill a bare `window` global
  (some edge/worker runtimes) — verify this against the existing
  `environment/` detection module (`CLAUDE.md` "edge downgrades axios→fetch")
  for consistency; reuse that module's existing environment-detection logic
  instead of a second, slightly different ad-hoc check if one already
  exists there.

## Tests to add

`packages/core/src/utilities/serverOnly.test.ts` (new): simulate `window`/
`window.document` present → throws `ConfigurationError` with the expected
message; absent → no throw.

`packages/core/src/server/rpc.test.ts` (extend existing `S#` threat-case
suite — this is a natural fit alongside the deny-by-default allowlist
tests): add an `S#` case for `createRpcHandler` constructed with a mocked
browser-like global, asserting immediate throw; and one asserting
`enforceServerOnly: false` suppresses it.

`packages/core/src/factory/createModuleProxy.test.ts` (extend): a
`serverOnly: true` module throws on first call in a simulated browser
context; a normal module is unaffected.

## Docs to update after shipping

`docs/ssr-rpc-bridge.md` — document `enforceServerOnly` as on-by-default and
the jsdom test opt-out; cross-reference `SECURITY.md`.
