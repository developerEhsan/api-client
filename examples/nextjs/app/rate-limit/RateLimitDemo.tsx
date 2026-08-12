'use client';

/**
 * RPC RATE-LIMITING DEMO
 * -----------------------
 * Docs: https://github.com/developerEhsan/api-client/blob/master/docs/rpc-rate-limiting.md
 *
 * The RPC bridge behind `/api/rpc-rate-limit-demo` allows only 3 calls per
 * 10s (see `rateLimitDemoHandler` in `lib/api/api.config.ts`). Click "Fire 5
 * calls" to send 5 sequential requests — the first 3 succeed, the last 2
 * come back as a uniform `rate_limited` `ApiError` with `status === 429`,
 * rehydrated on the browser exactly like any other typed error.
 */
import { apiRateLimitDemo } from '@/lib/api/rate-limit-demo-client';
import { ApiError } from '@developerehsan/api-client/browser';
import { useState } from 'react';

type Outcome = { n: number; ok: true; title: string } | { n: number; ok: false; message: string };

export function RateLimitDemo() {
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [busy, setBusy] = useState(false);

  async function fireFive() {
    setBusy(true);
    setOutcomes([]);
    for (let n = 1; n <= 5; n++) {
      try {
        const product = await apiRateLimitDemo.products.getProductById({ id: 1 });
        setOutcomes((prev) => [...prev, { n, ok: true, title: product.title }]);
      } catch (error) {
        const message =
          error instanceof ApiError
            ? `ApiError status=${error.status} code=${error.code ?? '?'}: ${error.message}`
            : String(error);
        setOutcomes((prev) => [...prev, { n, ok: false, message }]);
      }
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 font-sans text-slate-900 sm:px-6 lg:px-8">
      <div className="mb-10 space-y-3">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">RPC rate limiting</h1>
        <p className="text-slate-500 leading-relaxed">
          The bridge behind this page allows 3 calls / 10s. Firing 5 sequential calls should
          show the first 3 succeed and the last 2 come back as a 429{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
            rate_limited
          </code>{' '}
          error.
        </p>
      </div>

      <button
        onClick={fireFive}
        disabled={busy}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
      >
        {busy ? 'Firing…' : 'Fire 5 calls'}
      </button>

      <ul className="mt-6 space-y-2">
        {outcomes.map((o) => (
          <li
            key={o.n}
            className={`rounded-md border p-3 font-mono text-sm ${
              o.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            #{o.n}: {o.ok ? `OK — "${o.title}"` : o.message}
          </li>
        ))}
      </ul>
    </main>
  );
}
