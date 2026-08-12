/**
 * CACHE PERSISTENCE DEMO
 * ----------------------
 * Docs: https://github.com/developerEhsan/api-client/blob/master/docs/cache-persistence.md
 *
 * `cache.persistentStore` layers a durable L2 store (here, IndexedDB) behind
 * the in-memory L1. Writes go through both; a cache hit after a full page
 * reload proves the entry survived — the in-memory L1 does NOT survive a
 * reload, so any hit you see here came from IndexedDB.
 *
 * Reload the page after fetching once and press "Fetch product 1" again: it
 * resolves instantly and the log explains why.
 */
import { createClient, defineModule } from '@developerehsan/api-client';
import { createIndexedDbStore } from '@developerehsan/api-client/cache-stores';
import { useState } from 'react';
import { Button, Panel } from '../components/ui';

const persistentStore = createIndexedDbStore({ dbName: 'demo-cache-persistence' });

const persistedApi = createClient({
  baseURL: 'https://dummyjson.com',
  openapi: { mode: 'runtime' },
  cache: {
    strategy: 'cache-first',
    ttl: 5 * 60_000, // 5 minutes — long enough to survive a manual reload
    persistentStore,
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

// `createClient` (untyped) returns modules as `unknown` by design — cast the
// one custom module surface we actually call, same pattern as DirectClientDemo.
const products = persistedApi.products as {
  getOne: (id: number) => Promise<unknown>;
};

export function CachePersistenceDemo() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const push = (line: string) => setLog((prev) => [...prev.slice(-20), line]);

  async function fetchProduct() {
    setBusy(true);
    try {
      const t0 = performance.now();
      const p = await products.getOne(1);
      const ms = Math.round(performance.now() - t0);
      push(
        `products/1 "${(p as { title?: string }).title}" in ${ms}ms` +
          (ms < 15
            ? ' — served from cache (memory L1, or IndexedDB L2 if this is right after a reload)'
            : ' — network (first fetch, or the 5-minute TTL expired)'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function clearPersistentStore() {
    await persistentStore.clear();
    push('cleared the IndexedDB store — next fetch will hit the network even after reload');
  }

  return (
    <Panel
      title="Cache persistence (IndexedDB)"
      subtitle="Fetch once, reload the page, fetch again — the second fetch after reload still hits IndexedDB, not the network."
    >
      <div style={{ display: 'flex', gap: 8 }}>
        <Button disabled={busy} onClick={fetchProduct}>
          Fetch product 1
        </Button>
        <Button className="btn--ghost" onClick={() => window.location.reload()}>
          Reload page
        </Button>
        <Button className="btn--ghost" onClick={clearPersistentStore}>
          Clear IndexedDB store
        </Button>
      </div>
      <pre style={{ marginTop: 12, maxHeight: 200, overflow: 'auto' }}>{log.join('\n')}</pre>
    </Panel>
  );
}
