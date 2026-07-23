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
