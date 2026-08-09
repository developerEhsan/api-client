# Multi-tenancy

[← Docs index](./README.md)

Inject a tenant id header, resolved with this precedence:

```
per-call tenantId  →  configured getTenantId()  →  ambient server context
```

```ts
createClient({
  tenancy: {
    headerName: 'X-Tenant-ID',            // default
    getTenantId: () => currentTenant.id,  // sync or async
  },
})

// Per-call override:
await api.invoices.list(params, { tenantId: 'acme' })
```

If nothing resolves, no tenant header is sent (tenant-agnostic endpoints are
fine). If `getTenantId` throws, a `ConfigurationError` is raised before the call.

Cache/dedup keys include the tenant id, so tenants never see each other's data —
see [caching](./caching.md) and [deduplication](./deduplication.md).

**Same VM, two identities, one stale cache after a mutation:** the cache key
includes the tenant/auth scope, so a GET from user A and the same GET from
user B are stored under different keys on the very same process. A plain
`invalidate(pattern)` only clears the key the caller happens to know about —
if A's admin update only invalidates A's key, B's differently-scoped copy of
the same resource stays stale. [Tag-based invalidation](./caching.md#tag-based-invalidation)
fixes this: a tag maps to every key filed under it, independent of scope, so
one `invalidatesTags` clears every tenant/user's cached copy in one pass.

**Multiple server instances:** the tag index above is per-process — it does
not by itself reach a sibling instance behind a load balancer. See
[cache persistence → multiple server instances](./cache-persistence.md#multiple-server-instances-cross-instance-invalidation)
for the opt-in Redis pub/sub broadcast that closes that gap.

**Same URL, different scope beyond tenant/auth:** tenant/auth scoping covers
"which tenant/user is asking," not "which target resource/workspace they're
looking at" — an admin dashboard viewing "as" a specific user, or a
multi-workspace app carrying the active workspace in a header rather than
the URL, needs an extra key dimension on top. See
[caching → scoping cache by more than the URL](./caching.md#scoping-cache-by-more-than-the-url)
(`cacheKeyParts`) — the safe way to extend this same scoping mechanism
without reimplementing it by hand via `keyResolver`.

## Server-side (Next.js RSC / concurrent requests)

`AsyncLocalStorage` keeps concurrent server requests isolated:

```ts
import { runWithTenant, getTenantFromContext, serverTenantResolver } from '@developerehsan/api-client'

// Read the ambient context:
createClient({ tenancy: { getTenantId: getTenantFromContext } })
// or read a request header directly:
createClient({ tenancy: { getTenantId: serverTenantResolver('x-tenant-id') } })

// Wrap per-request server work so each request has its own tenant:
export async function handler(tenantId: string) {
  return runWithTenant(tenantId, async () => {
    return api.invoices.list()   // sees `tenantId`, isolated from other requests
  })
}
```

See [frameworks](./frameworks.md) for the full Next.js server pattern.
</content>
