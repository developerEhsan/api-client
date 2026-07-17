'use client';

import { apiHttp } from '@/lib/api/rpc-http-client';
import { ApiError } from '@developerehsan/api-client/browser';
import { useState } from 'react';

/**
 * Generic HTTP-transport variant. Same client surface as the Server Action demo,
 * but every call is a `POST /api/rpc` (see `lib/api/rpc-http-client.ts` and
 * `app/api/rpc/route.ts`). This is the framework-agnostic path that also works
 * outside Next.js (TanStack Start, Remix, …). Network tab shows POST /api/rpc
 * with `{ module, method, args }` — still no backend URL or paths.
 */

export function HttpDemo() {
  const [out, setOut] = useState('Click to call via POST /api/rpc.');

  async function run() {
    setOut('Loading…');
    try {
      const list = await apiHttp.products.listProducts({ limit: 5 });
      setOut(
        JSON.stringify(
          list.products.map((p) => p.title),
          null,
          2,
        ),
      );
    } catch (error) {
      setOut(
        error instanceof ApiError
          ? `ApiError ${error.status ?? ''}: ${error.message}`
          : String(error),
      );
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 font-sans text-slate-900 sm:px-6 lg:px-8">
      <div className="mb-10 space-y-3">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">httpTransport Variant</h1>
        <p className="text-slate-500 leading-relaxed">
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm text-slate-800">
            apiHttp.products.listProducts()
          </code>{' '}
          →{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm text-slate-800">
            POST /api/rpc
          </code>
          . Same bridge, no Server Action. This is the framework-agnostic path.
        </p>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
          <h2 className="font-semibold text-slate-800">Standard HTTP Fetch</h2>
        </div>

        <div className="space-y-4 p-6">
          <button
            onClick={run}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Fetch products
          </button>

          <pre className="max-h-96 overflow-x-auto rounded-lg bg-slate-50 p-4 font-mono text-sm text-slate-800 shadow-inner border border-slate-100">
            {out}
          </pre>
        </div>
      </section>
    </main>
  );
}
