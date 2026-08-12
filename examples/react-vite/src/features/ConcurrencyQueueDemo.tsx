/**
 * CONCURRENCY QUEUE DEMO
 * ----------------------
 * Docs: https://github.com/developerEhsan/api-client/blob/master/docs/concurrency-queue.md
 *
 * `http.queue.concurrency` caps how many requests run at once; the rest wait
 * in a FIFO (or LIFO) queue and are released as slots free up. This file is
 * self-contained: it builds its OWN client (concurrency: 2) so the counts you
 * see are not muddied by the shared app client's `concurrency: 6`.
 *
 * Fires 8 identical-looking (but distinctly-keyed) requests at once against a
 * slow DummyJSON endpoint and renders, live, how many are actually in flight
 * vs. still queued.
 */
import { createClient, defineModule } from '@developerehsan/api-client';
import { useRef, useState } from 'react';
import { Button, Panel } from '../components/ui';

// A dedicated client — queue.concurrency: 2 means at most 2 of the 8 calls
// below ever run at the same time; the other 6 sit in the FIFO queue.
const queuedApi = createClient({
  baseURL: 'https://dummyjson.com',
  openapi: { mode: 'runtime' },
  http: {
    queue: { enabled: true, concurrency: 2, priority: 'fifo' },
  },
  modules: {
    auto: false,
    slow: defineModule({
      methods: {
        // `/http/200?delay=` on DummyJSON sleeps server-side before responding,
        // so each call is slow enough to make the queue visible.
        fetchOne: (ctx, n: number) =>
          ctx.request({ method: 'GET', path: '/http/200', query: { delay: 1200, n } }),
      },
    }),
  },
});

// `createClient` (untyped) types every module as `unknown` by design — cast
// the one custom method surface we actually call.
const slow = queuedApi.slow as { fetchOne: (n: number) => Promise<unknown> };

type Slot = { id: number; state: 'queued' | 'running' | 'done' };

export function ConcurrencyQueueDemo() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [busy, setBusy] = useState(false);
  const runIdRef = useRef(0);

  async function runBurst() {
    setBusy(true);
    const runId = ++runIdRef.current;
    const initial: Slot[] = Array.from({ length: 8 }, (_, i) => ({
      id: i,
      state: 'queued',
    }));
    setSlots(initial);

    const mark = (id: number, state: Slot['state']) => {
      if (runIdRef.current !== runId) return; // a newer burst superseded this one
      setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, state } : s)));
    };

    // The 'request' event fires only once the queue actually admits a call
    // (queue → dedup → cache → auth → dispatch, per CLAUDE.md's pipeline order),
    // so this is the true "now running" signal — not just "call was issued".
    const onRequest = (payload: unknown) => {
      const url = (payload as { url?: string })?.url ?? '';
      const match = url.match(/[?&]n=(\d+)/);
      if (match) mark(Number(match[1]), 'running');
    };
    queuedApi.on('request', onRequest);

    try {
      await Promise.all(
        initial.map(async (slot) => {
          await slow.fetchOne(slot.id);
          mark(slot.id, 'done');
        }),
      );
    } finally {
      queuedApi.off('request', onRequest);
      if (runIdRef.current === runId) setBusy(false);
    }
  }

  const running = slots.filter((s) => s.state === 'running').length;
  const queued = slots.filter((s) => s.state === 'queued').length;
  const done = slots.filter((s) => s.state === 'done').length;

  return (
    <Panel
      title="Concurrency queue"
      subtitle="queue.concurrency: 2 — at most 2 of these 8 slow calls run at once."
    >
      <Button disabled={busy} onClick={runBurst}>
        {busy ? 'Running…' : 'Fire 8 requests'}
      </Button>

      <p style={{ marginTop: 12 }}>
        running: <strong>{running}</strong> (should never exceed 2) · queued:{' '}
        <strong>{queued}</strong> · done: <strong>{done}</strong>
      </p>

      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        {slots.map((s) => (
          <span
            key={s.id}
            className={`badge badge--${s.state === 'running' ? 'pending' : s.state === 'done' ? 'success' : 'default'}`}
            title={`slot ${s.id}: ${s.state}`}
          >
            #{s.id} {s.state}
          </span>
        ))}
      </div>
    </Panel>
  );
}
