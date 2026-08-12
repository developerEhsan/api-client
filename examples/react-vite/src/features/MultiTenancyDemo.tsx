/**
 * MULTI-TENANCY DEMO
 * ------------------
 * Docs: https://github.com/developerEhsan/api-client/blob/master/docs/multi-tenancy.md
 *
 * `tenancy.getTenantId` resolves a tenant id that is (a) sent as a header on
 * every request and (b) folded into the cache key, so two tenants calling the
 * same endpoint never see each other's cached response.
 *
 * This is a dedicated client (not the shared app one) so the tenant switch and
 * cache isolation are easy to observe in isolation.
 */
import { createClient, defineModule } from '@developerehsan/api-client';
import { useState } from 'react';
import { Button, Panel } from '../components/ui';

let activeTenant = 'acme';

const tenantApi = createClient({
  baseURL: 'https://dummyjson.com',
  openapi: { mode: 'runtime' },
  cache: { strategy: 'cache-first', ttl: 60_000 },
  tenancy: {
    headerName: 'X-Tenant-ID',
    getTenantId: () => activeTenant,
  },
  modules: {
    auto: false,
    products: defineModule({
      methods: {
        getOne: (ctx, id: number) =>
          ctx.request({ method: 'GET', path: '/products/{id}', pathParams: { id } }),
      },
    }),
  },
});

// `createClient` (untyped) types every module as `unknown` by design — cast
// the one custom method surface we actually call.
const products = tenantApi.products as { getOne: (id: number) => Promise<unknown> };

export function MultiTenancyDemo() {
  const [tenant, setTenant] = useState('acme');
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const push = (line: string) => setLog((prev) => [...prev.slice(-20), line]);

  function switchTenant(next: string) {
    activeTenant = next;
    setTenant(next);
    push(`switched active tenant → "${next}" (no cache clear needed — keys are scoped)`);
  }

  async function fetchForTenant() {
    setBusy(true);
    try {
      const t0 = performance.now();
      const p = await products.getOne(1);
      const ms = Math.round(performance.now() - t0);
      push(
        `tenant "${activeTenant}": products/1 "${(p as { title?: string }).title}" in ${ms}ms` +
          (ms < 5 ? ' (cache hit — same tenant seen before)' : ' (network — first time for this tenant)'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Multi-tenancy"
      subtitle="Each tenant gets its own cache entry for the SAME endpoint — the tenant id is folded into the cache key."
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {['acme', 'globex', 'initech'].map((t) => (
          <Button
            key={t}
            className={t === tenant ? '' : 'btn--ghost'}
            onClick={() => switchTenant(t)}
          >
            {t}
            {t === tenant ? ' ✓' : ''}
          </Button>
        ))}
      </div>

      <Button disabled={busy} onClick={fetchForTenant}>
        Fetch products/1 as "{tenant}"
      </Button>

      <p style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
        Fetch as "acme", then "globex", then "acme" again — the third call is a cache hit
        (fast), proving acme's cached copy survived the switch and stayed isolated from
        globex's.
      </p>

      <pre style={{ marginTop: 12, maxHeight: 200, overflow: 'auto' }}>{log.join('\n')}</pre>
    </Panel>
  );
}
