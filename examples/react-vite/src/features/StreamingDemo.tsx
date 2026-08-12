/**
 * STREAMING DEMO
 * --------------
 * Docs: https://github.com/developerEhsan/api-client/blob/master/docs/streaming.md
 *
 * `ctx.stream(spec, options)` returns an AsyncIterable over a live HTTP
 * response body — NDJSON, SSE, or raw bytes — bypassing cache/dedup/response
 * validation (meaningless for a stream). This demo hits two dev-server-local
 * endpoints (see `vite.config.ts`'s `localStreamingBackend`) that emit one
 * chunk every ~400ms, so you can watch rows/events render incrementally
 * rather than all at once when the request completes.
 */
import type { ModuleContext, SseEvent } from '@developerehsan/api-client';
import { createClient, defineModule } from '@developerehsan/api-client';
import { useRef, useState } from 'react';
import { Button, Panel } from '../components/ui';

interface Chunk {
  seq: number;
  at: number;
}

// A module method's return type must be `Promise<unknown>` (see
// `ModuleMethods` in types/module.types.ts) — an async GENERATOR isn't
// assignable to that. So the module exposes the `ctx` itself (a documented,
// type-safe pattern — see packages/core/src/factory/stream.test.ts) and the
// caller invokes `ctx.stream(...)` directly, which is what actually returns
// the `AsyncIterable`.
const streamApi = createClient({
  // Same origin as the Vite dev server, so relative paths hit the local
  // streaming middleware directly (no CORS, no external dependency).
  baseURL: window.location.origin,
  openapi: { mode: 'runtime' },
  modules: {
    auto: false,
    stream: defineModule({
      methods: {
        handle: async (ctx: ModuleContext) => ctx,
      },
    }),
  },
});

const stream = streamApi.stream as { handle: () => Promise<ModuleContext> };

export function StreamingDemo() {
  const [ndjsonRows, setNdjsonRows] = useState<Chunk[]>([]);
  const [sseLines, setSseLines] = useState<string[]>([]);
  const [busy, setBusy] = useState<'ndjson' | 'sse' | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function runNdjson() {
    setNdjsonRows([]);
    setBusy('ndjson');
    try {
      const ctx = await stream.handle();
      for await (const row of ctx.stream<Chunk>(
        { method: 'GET', path: '/__stream/ndjson' },
        { mode: 'ndjson' },
      )) {
        // Each `setNdjsonRows` call happens as soon as a chunk arrives — not
        // after the whole stream finishes — which is the point of this demo.
        setNdjsonRows((prev) => [...prev, row]);
      }
    } finally {
      setBusy(null);
    }
  }

  async function runSse() {
    setSseLines([]);
    setBusy('sse');
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const ctx = await stream.handle();
      for await (const event of ctx.stream<SseEvent>(
        { method: 'GET', path: '/__stream/sse' },
        { mode: 'sse', signal: ac.signal },
      )) {
        setSseLines((prev) => [
          ...prev,
          `event=${event.event ?? '(none)'} data=${event.data}`,
        ]);
      }
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  }

  return (
    <Panel
      title="Streaming"
      subtitle="NDJSON and SSE via ctx.stream — rows/events render as they arrive, not on completion."
    >
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div>
          <Button disabled={busy !== null} onClick={runNdjson}>
            {busy === 'ndjson' ? 'Streaming NDJSON…' : 'Stream NDJSON (5 rows)'}
          </Button>
          <ul>
            {ndjsonRows.map((r) => (
              <li key={r.seq}>
                seq {r.seq} @ {new Date(r.at).toLocaleTimeString()}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <Button disabled={busy !== null} onClick={runSse}>
            {busy === 'sse' ? 'Streaming SSE…' : 'Stream SSE (5 events)'}
          </Button>
          <ul>
            {sseLines.map((line, i) => (
              // biome-ignore lint: static demo list, index key is fine
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
