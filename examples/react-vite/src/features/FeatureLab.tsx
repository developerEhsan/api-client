import {
  ApiError,
  TimeoutError,
  createClient,
  defineModule,
  isAbortError,
} from '@developerehsan/api-client';
/**
 * FEATURE LAB
 * -----------
 * Interactive buttons that each exercise ONE pipeline feature. The log panel
 * mirrors the client's real events (api.on 'request'/'response'/'error') plus a
 * note from each handler, so you can watch the pipeline work.
 *
 * Covered: caching/SWR, deduplication, timeout, cancellation, typed errors,
 * safeMode, a composed multi-endpoint call, and ctx.run (non-HTTP logic).
 */
import { useState } from 'react';
import { Button, LogView, Panel, useEventLog } from '../components/ui';
import { api } from '../lib/api/api.config';

// A second client with safeMode enabled — methods return a discriminated
// { success, data } | { success, error } result instead of throwing.
const safeApi = createClient({
  baseURL: 'https://dummyjson.com',
  openapi: { mode: 'runtime' },
  safeMode: true,
  modules: {
    auto: false,
    products: defineModule({
      methods: {
        get: async (ctx, id: number) =>
          ctx.request({ method: 'GET', path: '/products/{id}', pathParams: { id } }),
      },
    }),
  },
});

export function FeatureLab() {
  const { lines, clear, push } = useEventLog(true);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title="Feature lab"
      subtitle="Click a button and watch the live pipeline log on the right."
    >
      <div className="lab">
        <div className="lab__buttons">
          {/* CACHING / SWR */}
          <Button
            disabled={!!busy}
            onClick={() =>
              run('cache', async () => {
                push('info', 'cache: calling getProductById({ id: 1 }) twice…');
                const t1 = performance.now();
                await api.products.getProductById({ id: 1 });
                const first = Math.round(performance.now() - t1);
                const t2 = performance.now();
                await api.products.getProductById({ id: 1 });
                const second = Math.round(performance.now() - t2);
                push('info', `cache: first ${first}ms → second ${second}ms (served from cache)`);
              })
            }
          >
            Caching / SWR
          </Button>

          {/* DEDUPLICATION */}
          <Button
            disabled={!!busy}
            onClick={() =>
              run('dedup', async () => {
                push('info', 'dedup: firing 6 identical requests at once…');
                await Promise.all(
                  Array.from({ length: 6 }, () => api.products.listProducts({ limit: 5 })),
                );
                push('info', "dedup: note only ONE '→ request' above — the rest shared it.");
              })
            }
          >
            Deduplication (6→1)
          </Button>

          {/* TIMEOUT */}
          <Button
            disabled={!!busy}
            onClick={() =>
              run('timeout', async () => {
                push('info', 'timeout: per-call timeout of 1ms → should abort…');
                try {
                  await api.products.listProducts({ limit: 5 }, { timeout: 1 });
                  push('info', 'timeout: (network was faster than 1ms — try again)');
                } catch (e) {
                  push(
                    'info',
                    e instanceof TimeoutError
                      ? 'timeout: caught TimeoutError ✓'
                      : `timeout: ${String(e)}`,
                  );
                }
              })
            }
          >
            Timeout (1ms)
          </Button>

          {/* CANCELLATION */}
          <Button
            disabled={!!busy}
            onClick={() =>
              run('cancel', async () => {
                push('info', 'cancel: starting request then aborting it…');
                const ac = new AbortController();
                const p = api.products.listProducts({ limit: 5 }, { signal: ac.signal });
                ac.abort();
                try {
                  await p;
                  push('info', 'cancel: (completed before abort — try again)');
                } catch (e) {
                  push(
                    'info',
                    isAbortError(e) ? 'cancel: caught AbortError ✓' : `cancel: ${String(e)}`,
                  );
                }
              })
            }
          >
            Cancellation
          </Button>

          {/* TYPED ERROR */}
          <Button
            disabled={!!busy}
            onClick={() =>
              run('error', async () => {
                push('info', 'error: getProductById({ id: 0 }) → expect 404…');
                try {
                  await api.products.getProductById({ id: 0 });
                } catch (e) {
                  if (e instanceof ApiError) {
                    push('info', `error: ApiError status=${e.status} code=${e.code ?? '—'} ✓`);
                  } else {
                    push('info', `error: ${String(e)}`);
                  }
                }
              })
            }
          >
            Typed error (404)
          </Button>

          {/* SAFEMODE */}
          <Button
            disabled={!!busy}
            onClick={() =>
              run('safe', async () => {
                push('info', 'safeMode: calling safeApi.products.get(0) — no throw…');
                const safeProducts = safeApi.products as {
                  get: (
                    id: number,
                  ) => Promise<
                    { success: true; data: unknown } | { success: false; error: ApiError }
                  >;
                };
                const result = await safeProducts.get(0);
                if (result.success) push('info', 'safeMode: success:true');
                else push('info', `safeMode: success:false, error.status=${result.error.status} ✓`);
              })
            }
          >
            safeMode result
          </Button>

          {/* COMPOSED */}
          <Button
            disabled={!!busy}
            onClick={() =>
              run('composed', async () => {
                push('info', 'composed: getWithSiblings(1) — product + category siblings…');
                const { product, siblings } = await api.products.getWithSiblings(1);
                push('info', `composed: "${product.title}" + ${siblings.length} siblings ✓`);
              })
            }
          >
            Composed call
          </Button>

          {/* CTX.RUN — non-HTTP module logic */}
          <Button
            disabled={!!busy}
            onClick={() =>
              run('ctxrun', async () => {
                push('info', 'ctx.run: analytics.summarize() — deduped + retried…');
                const s = await api.analytics.summarize();
                push('info', `ctx.run: ${s.count} products, avg $${s.avgPrice} ✓`);
              })
            }
          >
            ctx.run (analytics)
          </Button>

          <Button className="btn--ghost" onClick={clear}>
            Clear log
          </Button>
        </div>

        <div className="lab__log">
          <LogView lines={lines} />
        </div>
      </div>
    </Panel>
  );
}
