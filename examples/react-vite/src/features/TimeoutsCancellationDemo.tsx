/**
 * TIMEOUTS & CANCELLATION DEMO
 * ----------------------------
 * Docs: https://github.com/developerEhsan/api-client/blob/master/docs/timeouts-and-cancellation.md
 *
 * Two distinct ways a request can end early, with two distinct error types:
 *   - a per-call `timeout` (ms) — the client enforces it via AbortController
 *     even on adapters (like fetch) with no native timeout — throws TimeoutError.
 *   - caller-driven cancellation via `AbortSignal` (`{ signal }`) — throws an
 *     AbortError-shaped error, detected with `isAbortError`.
 *
 * This file is deliberately self-contained (own client) so both paths are
 * visible side by side without the rest of the app's config in the way.
 */
import { TimeoutError, createClient, defineModule, isAbortError } from '@developerehsan/api-client';
import { useRef, useState } from 'react';
import { Button, Panel } from '../components/ui';

const api = createClient({
  baseURL: 'https://dummyjson.com',
  openapi: { mode: 'runtime' },
  http: { timeout: 8000, retry: { attempts: 1 } }, // 1 = one attempt, no retries — one clean failure per click
  modules: {
    auto: false,
    slow: defineModule({
      methods: {
        // Server-side delay, so both timeout and cancellation have time to fire
        // before the response would otherwise arrive.
        fetch: (ctx, opts?: { timeout?: number; signal?: AbortSignal }) =>
          ctx.request({ method: 'GET', path: '/http/200', query: { delay: 3000 } }, opts),
      },
    }),
  },
});

// `createClient` (untyped) types every module as `unknown` by design — cast
// the one custom method surface we actually call.
const slow = api.slow as {
  fetch: (opts?: { timeout?: number; signal?: AbortSignal }) => Promise<unknown>;
};

export function TimeoutsCancellationDemo() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<'timeout' | 'cancel' | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const push = (line: string) => setLog((prev) => [...prev.slice(-20), line]);

  async function triggerTimeout() {
    setBusy('timeout');
    push('timeout: calling a 3s-delayed endpoint with a 200ms per-call timeout…');
    try {
      await slow.fetch({ timeout: 200 });
      push('timeout: (network was somehow faster than 200ms — try again)');
    } catch (e) {
      push(
        e instanceof TimeoutError
          ? `timeout: caught TimeoutError ✓ (message: ${e.message})`
          : `timeout: unexpected error — ${String(e)}`,
      );
    } finally {
      setBusy(null);
    }
  }

  async function startThenCancel() {
    setBusy('cancel');
    push('cancel: starting a 3s-delayed request, aborting it after 150ms…');
    const ac = new AbortController();
    controllerRef.current = ac;
    const pending = slow.fetch({ signal: ac.signal });
    setTimeout(() => ac.abort(), 150);
    try {
      await pending;
      push('cancel: (completed before the abort fired — try again)');
    } catch (e) {
      push(
        isAbortError(e)
          ? 'cancel: caught an AbortError ✓ (isAbortError(e) === true)'
          : `cancel: unexpected error — ${String(e)}`,
      );
    } finally {
      controllerRef.current = null;
      setBusy(null);
    }
  }

  return (
    <Panel
      title="Timeouts & cancellation"
      subtitle="Two different early-exit paths, two different error shapes — TimeoutError vs. AbortError."
    >
      <div style={{ display: 'flex', gap: 8 }}>
        <Button disabled={busy !== null} onClick={triggerTimeout}>
          {busy === 'timeout' ? 'Waiting…' : 'Trigger timeout (200ms)'}
        </Button>
        <Button disabled={busy !== null} onClick={startThenCancel}>
          {busy === 'cancel' ? 'Waiting…' : 'Start then cancel (150ms)'}
        </Button>
      </div>
      <pre style={{ marginTop: 12, maxHeight: 200, overflow: 'auto' }}>{log.join('\n')}</pre>
    </Panel>
  );
}
