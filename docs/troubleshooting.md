# Troubleshooting & FAQ

[← Docs index](./README.md)

**`api.myModule.myMethod is not a function`**
You called a method you did not declare in `defineModule`. The runtime methods
are the ones you declare — [codegen](./codegen.md) produces types/descriptors,
not runtime methods. Add the method (usually a thin `ctx.request(...)` wrapper),
or use `modules: { auto: true }` to derive methods from the runtime schema.

**My `fetch` request never times out.**
It does now — timeouts are enforced by the client regardless of adapter. Make
sure you set `http.timeout` (default 10s). See
[timeouts & cancellation](./timeouts-and-cancellation.md).

**Two different users got the same cached/deduped response.**
This cannot happen: cache and dedup keys include an auth fingerprint and tenant
id. If you see stale data, check your `getToken`/`getTenantId` actually return
per-user values. See [caching](./caching.md) and [deduplication](./deduplication.md).

**OAuth2 keeps refreshing in a loop.**
A second 401 after a refresh is not re-refreshed — it surfaces as `AuthError`.
If refresh keeps failing, verify `refreshEndpoint` and that `onTokensRefreshed`
actually persists the new token your `getAccessToken` reads. See
[authentication](./authentication.md#oauth2-with-automatic-refresh).

**Edge deploy fails trying to load `axios`.**
It shouldn't — the edge build uses `fetch` and never statically imports Axios.
Force `http.adapter: 'fetch'` if a bundler misdetects the runtime. See
[frameworks](./frameworks.md#edge-runtimes-vercel-edge-cloudflare-workers).

**Response validation throws in production.**
Set `openapi.validation.mode: 'loose'` (warn instead of throw), or disable it
outside development. See [schema validation](./schema-validation.md#loose-vs-strict).

**Cancelling a request still resolves with data.**
Aborts reject with an `AbortError` and are never converted to cache hits, even
with `network-first` or `safeMode`. Ensure you pass the `signal` via per-call
config. See [timeouts & cancellation](./timeouts-and-cancellation.md#cancellation-with-abortsignal).

**Stale generated types after editing `packages/core/src`.**
The examples and the `tanstack-query` package consume the **built `dist/`** of
core. After editing core, rebuild it (`pnpm --filter @developerehsan/api-client
build`) before typechecking dependents.

**A build warning mentions `node:async_hooks` being externalized (browser).**
That's the server-only tenant-context helper, guarded so it no-ops in browsers.
Harmless.

**The RPC bridge type-checks a method that returns "unknown method" at runtime.**
The bridge client *type* mirrors your whole API surface; the `expose` allowlist
is the runtime gate. Add the method to `expose` (or it stays denied by design).
See [SSR RPC bridge](./ssr-rpc-bridge.md#security-model-deny-by-default).

---

## Contributing to the library itself

```bash
pnpm install
pnpm -r build       # build all packages
pnpm -r typecheck   # strict tsc
pnpm -r test        # vitest
```

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) and [`CLAUDE.md`](../CLAUDE.md) for
the monorepo layout and build-ordering notes.
</content>
