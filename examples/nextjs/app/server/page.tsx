import { api } from '@/lib/api/api.config';
import { ApiError } from '@developerehsan/api-client';

/**
 * Server Component — direct usage, NO bridge needed.
 *
 * On the server the real `api` is already safe: the request never touches the
 * browser, so the base URL and paths aren't exposed. Call it directly in a
 * Server Component / Route Handler / Server Action. The bridge (Server Action +
 * /api/rpc) exists only so CLIENT components can call the same API without
 * leaking those secrets.
 *
 * `force-dynamic` keeps this out of the static build (it fetches per request).
 */

export const dynamic = 'force-dynamic';

export default async function ServerPage() {
  let body: string;
  try {
    const list = await api.products.listProducts({ limit: 5 });
    body = JSON.stringify(list.products.map((p) => p.title), null, 2);
  } catch (error) {
    body =
      error instanceof ApiError
        ? `ApiError ${error.status ?? ''}: ${error.message}`
        : String(error);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 font-sans text-slate-900 sm:px-6 lg:px-8">
      <div className="mb-10 space-y-3">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Server Component — Direct API
        </h1>
        <p className="text-slate-500 leading-relaxed">
          Fetched on the server directly with{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm text-slate-800">
            await api.products.listProducts()
          </code>
          . No bridge, no client JS required for this call. The request never touches the browser, keeping base URLs and paths completely secure.
        </p>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
          <h2 className="font-semibold text-slate-800">Server Rendered Output</h2>
        </div>
        
        <div className="p-6">
          <pre className="max-h-96 overflow-x-auto rounded-lg bg-slate-50 p-4 font-mono text-sm text-slate-800 shadow-inner border border-slate-100">
            {body}
          </pre>
        </div>
      </section>
    </main>
  );
}
