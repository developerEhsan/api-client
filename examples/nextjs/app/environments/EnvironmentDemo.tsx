'use client';

/**
 * ENVIRONMENT SWITCHING DEMO (client shell)
 * ------------------------------------------
 * Docs: https://github.com/developerEhsan/api-client/blob/master/docs/environments.md
 *
 * Hits two API routes that run the SAME client config (`http.adapter: 'axios'`)
 * on two different Next.js runtimes:
 *   - `/api/env-node` (default `runtime = 'nodejs'`)  → Axios is available,
 *     stays 'axios'.
 *   - `/api/env-edge` (`runtime = 'edge'`)             → `detectEnvironment()`
 *     reports `supportsAxios: false`, so the client downgrades the requested
 *     'axios' adapter to 'fetch' (with a console.warn on the server).
 *
 * Each route calls `detectEnvironment()` itself and reports back the actual
 * `DetectedEnvironment` + which adapter ended up in effect — not just what was
 * requested — so the downgrade is verified, not assumed from route config.
 */
import { useState } from 'react';

interface EnvReport {
  route: string;
  environment: string;
  supportsAxios: boolean;
  requestedAdapter: string;
  effectiveAdapter: string;
}

export function EnvironmentDemo() {
  const [reports, setReports] = useState<EnvReport[]>([]);
  const [busy, setBusy] = useState(false);

  async function runBoth() {
    setBusy(true);
    try {
      const [node, edge] = await Promise.all([
        fetch('/api/env-node').then((r) => r.json()),
        fetch('/api/env-edge').then((r) => r.json()),
      ]);
      setReports([node, edge]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 font-sans text-slate-900 sm:px-6 lg:px-8">
      <div className="mb-10 space-y-3">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Environment detection &amp; adapter downgrade
        </h1>
        <p className="text-slate-500 leading-relaxed">
          Both routes request <code>http: {'{'} adapter: &apos;axios&apos; {'}'}</code>. Only the edge
          route gets downgraded to fetch.
        </p>
      </div>

      <button
        onClick={runBoth}
        disabled={busy}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
      >
        {busy ? 'Calling both routes…' : 'Call /api/env-node and /api/env-edge'}
      </button>

      <div className="mt-6 space-y-4">
        {reports.map((r) => (
          <pre
            key={r.route}
            className="overflow-x-auto rounded-lg border border-slate-100 bg-slate-50 p-4 font-mono text-sm text-slate-800 shadow-inner"
          >
            {JSON.stringify(r, null, 2)}
          </pre>
        ))}
      </div>
    </main>
  );
}
