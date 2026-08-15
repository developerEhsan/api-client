# 08 — Additional hardening (independent, smaller items)

Unlike files `01`-`07`, these are **independent of each other** — implement
in any order, skip any that turn out lower-value once the bigger items land.
Each has its own problem/design/security/tests, kept short.

---

## 8.1 Negative caching (cache "not found" responses)

**Problem:** repeated lookups for IDs that don't exist (deleted records, bad
input, enumeration attempts) hit the network every time — no protection
today since `cacheConfigured` only applies once a response is already
successful and cached (`createClient.ts:710-761` writes to cache on any
successful response, but a 404 still round-trips the network each time if
callers don't treat 404 as cacheable — verify current behavior: does the
existing write-through cache 404s already? If `runNetwork()` throws on 404
via `classifyError`, the entry never reaches `cacheStore.set` at all —
confirm this by reading the response/error classification path before
assuming negative caching is entirely missing.).

**Design:** add `cache.cacheableStatuses?: number[]` (default: `[200]` or
whatever the current implicit behavior is) to `CacheConfig`, allowing 404
(and other explicitly-listed statuses) to be cached with a **separate,
usually shorter** TTL: `cache.negativeTtl?: number`. Store these as normal
`CacheEntry` objects — no new type needed, just a second TTL value applied
when `response.status` is in the negative-cacheable list.

**Security:** a cached 404 must remain scoped by the same
tenant/auth-fingerprint key as any other entry — never let a negative cache
entry become a way to probe existence across tenants (this falls out
naturally from reusing `computeCacheKey` unchanged, just double-check the
write path doesn't bypass it for error responses).

**Tests:** 404 gets cached when configured, subsequent identical request
within `negativeTtl` doesn't hit the network (assert via a mock adapter call
count); a later successful creation of that resource plus a
tag-invalidation (file `01`) clears the negative entry too.

---

## 8.2 ETag / conditional request support

**Problem:** no `If-None-Match`/`ETag` forwarding — every cache-miss/
revalidation re-transfers and re-parses a full payload even when the server
would happily answer 304.

**Design:** when a `CacheEntry` has a captured `ETag` response header
(already stored in `entry.headers` today — no schema change needed), a
`network-first` or SWR revalidation fetch should send
`If-None-Match: <etag>`. On a `304`, keep the existing cached `data` but
refresh `storedAt`/`expiresAt` rather than treating it as a fresh network
body. This touches `runNetwork()`/`fetchThrough()` in `createClient.ts`
(around lines 744-761) — add the conditional header when a prior entry with
an `ETag` exists for this key, and special-case a `304` response to reuse
`entry.data`.

**Security:** none beyond what already applies to caching in general — ETag
values are opaque server-issued tokens, not user-controlled input.

**Tests:** a stored entry with an `ETag` header causes the next
revalidation request to include `If-None-Match`; a `304` response updates
freshness without altering `data`; an entry without a captured `ETag`
behaves exactly as today (no conditional header sent).

---

## 8.3 Cache hit/miss metrics hook

**Problem:** `resolved.hooks.onCacheHit`/`onCacheMiss` already exist
(`createClient.ts:716-723`) but there's no aggregate view — a developer
wanting a hit-rate percentage has to hand-roll counters in their own hook
implementation.

**Design:** add `client.cache.getStats(): { hits: number; misses: number; size: number; hitRate: number }`
to the `ClientCache` interface (`createClient.ts:1195-1202`), maintained by
incrementing counters in the existing `emitCacheHit`/`emitCacheMiss`
closures (`createClient.ts:716-723`) — purely additive, no new hook
mechanism needed, just aggregation of what already fires.

**Security:** none — this is local, in-process, numeric-only telemetry.

**Tests:** hits/misses increment correctly across cache-first,
network-first, and SWR strategies; `hitRate` computes correctly at 0
requests (no division by zero) and after a mix of hits/misses.

---

## 8.4 Circuit breaker for a failing persistent (L2) store

**Problem:** `createLayeredCacheStore` (`cache-stores/layered.ts:20-52`)
already swallows L2 errors per-call (`swallow()`, lines 21-23) so a single
failure never breaks a request — good. But if Redis is fully down, every
single request still attempts an L2 call and pays its full timeout latency
before falling through, repeatedly, for as long as the outage lasts.

**Design:** wrap the L2 calls inside `createLayeredCacheStore` with a
minimal circuit breaker: after N consecutive L2 failures within a window,
stop attempting L2 calls for a cool-down period (serve L1-only, matching
today's already-safe degraded behavior, just without paying the repeated
timeout cost). Expose the state via the `onStoreError` hook from file `07`
so it's observable (`{ op: 'circuit-open' }` or similar), not silent.

```ts
export interface LayeredCacheStoreOptions {
  circuitBreaker?: { failureThreshold: number; cooldownMs: number };
}
```

**Security:** none directly — this is a resilience/performance feature. Make
sure the cool-down doesn't accidentally cause `set()` writes to silently
stop being attempted forever (re-probe after cooldown, standard
half-open-circuit pattern) — a permanently-open circuit would quietly turn
persistent caching off with no way to recover without a restart.

**Tests:** N consecutive simulated L2 failures opens the circuit; L1-only
behavior during cooldown (assert the fake L2 client's methods aren't called
during the cooldown window); a probe attempt after cooldown either closes
the circuit (success) or reopens it (failure) — cover both.

---

## 8.5 At-rest encryption for browser-persisted cache (IndexedDB)

**Problem:** sensitive response data cached in IndexedDB sits in plaintext
in the browser's storage — a real finding in enterprise security reviews
for anything handling PII, even though it's same-origin-protected already.

**Design:** optional `encrypt` config on `IndexedDbStoreOptions` (file
`07`) accepting a pluggable cipher interface:

```ts
export interface CacheCipher {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}
```

Applied around the existing `JSON.stringify(entry)`/`JSON.parse` boundary in
`createIndexedDbStore`'s `set`/`get`. **Do not ship a default cipher/key
management scheme** — key handling (where does the encryption key come
from, how does it survive a page reload) is inherently
application-specific and getting it wrong is worse than not offering it;
ship the interface and clear documentation of the tradeoffs (e.g. a key
held only in memory means cache doesn't survive reload, which may defeat
the point of IndexedDB persistence in the first place — document this
tension explicitly rather than papering over it).

**Security:** this is the whole point of the feature — get the docs right
about what it does and doesn't protect against (protects against casual
inspection of browser storage / another origin somehow reading it via a
bug; does **not** protect against a compromised page's own JS, which by
definition can call `decrypt` itself). Don't oversell it.

**Tests:** with a fake reversible cipher, assert stored IndexedDB records
are transformed (not plaintext-equal to the original JSON) and read back
correctly; without `encrypt` configured, behavior is byte-for-byte
unchanged from today.

---

## 8.6 Logout-triggered cache clear

**Problem:** nothing today hooks "user logged out" to `client.cache.clear()`
(or a tenant/user-scoped subset of it) — privacy gap on shared devices,
and stale-scope entries linger until natural eviction.

**Design:** the auth layer already knows about session end via
`onRefreshFailed` (existing) and, if file `05` ships, potentially an
explicit `tokenStorage.clearTokens()` call site. Add a documented pattern
(not necessarily new API surface) recommending
`onRefreshFailed: async (e) => { await api.cache.clear(); redirectToLogin(); }`,
and evaluate whether a first-class `auth.onLogout` hook (distinct from
`onRefreshFailed`, since logout isn't always preceded by a failed refresh —
e.g. a user-initiated "log out" button) is worth adding:

```ts
// AuthConfig (base, shared across strategies) — new optional field
onLogout?: () => void | Promise<void>; // called by the app; client subscribes to auto-clear cache
```

More concretely: expose `client.on('logout', handler)` or reuse the existing
event-emitter surface (`createClient.ts` reserved `on`/`off` members) so an
app can do `api.logout()` → fires → client clears cache — but **only if such
an emitter already exists for this purpose**; check `hooks-and-events.md`
and the actual `on`/`off` implementation before adding a new event name, to
keep this consistent with whatever event vocabulary already exists rather
than inventing a parallel one.

**Security:** this is a privacy-positive feature by construction — the risk
is *not* implementing it consistently (e.g. clearing the tag index but not
a Redis L2 store) — must clear **every** configured layer (L1, L2/persistent
store, tag index) via the existing `client.cache.clear()` which already
routes through `createLayeredCacheStore.clear()` (`layered.ts:44-47`) —
confirm this file's addition doesn't introduce a second, incomplete clear
path.

**Tests:** triggering the logout path clears L1, L2 (fake persistent
store), and the tag index (file `01`) — assert all three are empty
afterward, not just L1.

---

## 8.7 Schema-version-based cache busting on deploy

**Problem:** `api.schema.hash` is already generated at build time
(`CLAUDE.md` "OpenAPI: build-time vs runtime") but isn't wired to cache
invalidation — a deploy that changes response shapes can leave old-shaped
cached entries being served to a newly-deployed frontend expecting the new
shape.

**Design:** embed the current schema hash into every `CacheEntry` at write
time (`schemaHash` field, alongside `storedAt`/`expiresAt`), and check it on
read: if the stored `schemaHash` doesn't match the client's current one,
treat the entry as a miss (evict and refetch) rather than serving
across-version stale data. Wire-up point: `createClient.ts`'s cache
read/write (~710-804) and wherever `schemaCache`/schema hash is already
tracked (`createClient.ts:1228-1229` area, `getSchema()`).

**Security:** not a security feature per se, but prevents a subtle
correctness bug (stale-shape data silently served) that could mask a
breaking API change — worth having regardless of severity.

**Tests:** an entry written under schema hash A is treated as a miss once
the client's active hash becomes B; unchanged hash behaves as today.

---

## 8.8 Dry-run / preview for pattern-based invalidation

**Problem:** `client.cache.invalidate(pattern)` (`createClient.ts:1196-1199`)
executes immediately — a typo'd glob (e.g. `user.*` matching far more than
intended) has no preview step before it wipes cache entries.

**Design:** add `client.cache.preview(pattern): string[]` returning the
keys that *would* be removed, without removing them — a thin read-only
wrapper around the same `globToRegExp` matching logic already in
`utilities/cache.ts:131-134`, reusable by extracting that regex-matching
loop into a shared, exported helper rather than duplicating it.

**Security:** none directly — pure ergonomics/safety-net for an already
locally-controlled API (this isn't attacker-reachable; it's a
foot-gun-prevention feature for the developer using the library).

**Tests:** `preview(pattern)` returns the same set `invalidate(pattern)`
would remove, without actually removing anything (assert cache state is
unchanged after `preview`, and equal-but-then-empty after a subsequent real
`invalidate` with the same pattern).

---

## Suggested sub-ordering within this file

If picking a subset: **8.6 (logout clear)** and **8.3 (metrics)** are
cheapest and highest-value for an enterprise deployment; **8.1 (negative
caching)** and **8.2 (ETag)** meaningfully cut network load; **8.4 (circuit
breaker)** matters most once file `02`'s Redis dependency is in place;
**8.5 (encryption)** and **8.7 (schema versioning)** are worth doing but
lower urgency than the rest; **8.8 (dry-run)** is trivial and low-risk —
good first PR for someone new to the codebase.
