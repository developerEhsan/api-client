import {
  ApiError,
  TimeoutError,
  createClient,
  defineModule,
  isAbortError,
} from '@developerEhsan/api-client';
/**
 * FEATURE LAB
 * -----------
 * Interactive buttons that each exercise ONE pipeline feature. The log panel
 * mirrors the client's real events (api.on 'request'/'response'/'error') plus a
 * note from each handler, so you can watch the pipeline work.
 *
 * Covered: caching/SWR, deduplication, timeout, cancellation, typed errors,
 * safeMode, and a composed multi-endpoint call.
 */
import { useState } from 'react';
import { Button, LogView, Panel, useEventLog } from '../components/ui';
import { api } from '../lib/api/api.config';

// A second client with safeMode enabled — methods return a discriminated
// { success, data } | { success, error } result instead of throwing.
const safeApi = createClient({
  baseURL: 'https://petstore3.swagger.io/api/v3',
  openapi: { mode: 'runtime' },
  safeMode: true,
  modules: {
    auto: false,
    pet: defineModule({
      methods: {
        get: async (ctx, petId: number) =>
          ctx.request({ method: 'GET', path: '/pet/{petId}', pathParams: { petId } }),
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
                push('info', 'cache: calling getInventory() twice…');
                const t1 = performance.now();
                await api.store.getInventory();
                const first = Math.round(performance.now() - t1);
                const t2 = performance.now();
                await api.store.getInventory();
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
                  Array.from({ length: 6 }, () =>
                    api.pet.findPetsByStatus({ status: 'available' }),
                  ),
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
                  await api.pet.findPetsByStatus({ status: 'available' }, { timeout: 1 });
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
                const p = api.pet.findPetsByStatus({ status: 'pending' }, { signal: ac.signal });
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
                push('info', 'error: getPetById({ petId: -1 }) → expect 404…');
                try {
                  await api.pet.getPetById({ petId: -1 });
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
                push('info', 'safeMode: calling safeApi.pet.get(-1) — no throw…');
                const safePet = safeApi.pet as {
                  get: (
                    petId: number,
                  ) => Promise<
                    { success: true; data: unknown } | { success: false; error: ApiError }
                  >;
                };
                const result = await safePet.get(-1);
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
                push('info', 'composed: getPetById + getInventory in parallel…');
                const [pet, inventory] = await Promise.all([
                  api.pet.getPetById({ petId: 1 }).catch(() => null),
                  api.store.getInventory(),
                ]);
                push(
                  'info',
                  `composed: pet=${pet?.name ?? 'n/a'}, inventory keys=${Object.keys(inventory).length} ✓`,
                );
              })
            }
          >
            Composed call
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
