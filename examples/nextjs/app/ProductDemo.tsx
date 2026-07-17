'use client';

import { q } from '@/lib/api/query';
import { api } from '@/lib/api/rpc-client';
import type { ProductInput } from '@/lib/api/types/generated/api.types';
import { ApiError } from '@developerehsan/api-client/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
/**
 * The whole point of this demo: this is a CLIENT component, yet every
 * `api.*.*()` call exposes nothing about the backend. Open the browser network
 * tab — you'll see only a POST to THIS origin carrying `{ module, method, args }`.
 * No `dummyjson.com`, no `/products/{id}`, no openapi.json — those live only on
 * the server, behind the RPC handler.
 *
 * Scenarios covered here:
 *   1. Direct read           — api.products.getProductById (note: `images` is
 *                              redacted server-side via transformResult).
 *   2. Direct write + authz  — api.products.addProduct is gated by an "editor"
 *                              cookie (the handler's `authorize` hook).
 *   3. Cancellation          — an AbortSignal cancels a call locally.
 *   4. Uniform denial        — a NON-exposed method returns the same generic
 *                              error as an unknown one (no enumeration).
 *   5. Batching              — 3 calls in one tick → ONE POST (coalesced).
 *   6. TanStack Query        — useQuery through the bridge.
 *   7. TanStack Mutation     — useMutation + cache invalidation.
 */

/** Render any thrown value; `instanceof ApiError` still works after rehydration. */
function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return `ApiError ${error.status ?? ''} [${error.code ?? '?'}]: ${error.message}`;
  }
  return String(error);
}

export function ProductDemo() {
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState(1);
  const [term, setTerm] = useState('phone');
  const [direct, setDirect] = useState('Click “Fetch product” to call the bridge.');
  const [writeResult, setWriteResult] = useState('');
  const [batchResult, setBatchResult] = useState('');
  const [isEditor, setIsEditor] = useState(
    () => typeof document !== 'undefined' && document.cookie.includes('demo_editor=1'),
  );

  // 6. TanStack Query
  const search = useQuery(q.products.queryOptions.searchProducts({ q: term }));

  // 7. TanStack Mutation
  const addMutation = useMutation(
    q.products.mutationOptions.addProduct({
      onSuccess: () => q.products.invalidateQueries(queryClient),
    }),
  );

  // 1. Direct read
  async function fetchDirect() {
    setDirect('Loading…');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const product = await api.products.getProductById(
        { id: productId },
        { signal: controller.signal }
      );
      setDirect(JSON.stringify(product, null, 2));
    } catch (error) {
      setDirect(describeError(error));
    } finally {
      clearTimeout(timer);
    }
  }

  // 2. Direct write
  async function addDirect() {
    setWriteResult('Adding…');
    const body: ProductInput = { title: `Widget-${Date.now() % 1000}`, price: 9.99, category: 'demo' };
    try {
      const product = await api.products.addProduct({ body });
      setWriteResult(`Added product #${product.id ?? '?'} (${product.title}).`);
      void q.products.invalidateQueries(queryClient);
    } catch (error) {
      setWriteResult(describeError(error));
    }
  }

  // 4. Uniform denial
  async function callForbidden() {
    try {
      await api.products.deleteProduct({ id: productId });
      setDirect('(unexpected) call succeeded');
    } catch (error) {
      setDirect(`Denied as expected → ${describeError(error)}`);
    }
  }

  // 5. Batching
  async function fetchBatch() {
    setBatchResult('Fetching #1, #2, #3 in one tick…');
    try {
      const [a, b, c] = await Promise.all([
        api.products.getProductById({ id: 1 }),
        api.products.getProductById({ id: 2 }),
        api.products.getProductById({ id: 3 }),
      ]);
      setBatchResult(
        `Got: "${a.title}", "${b.title}", "${c.title}". Network tab shows ONE POST (batched).`,
      );
    } catch (error) {
      setBatchResult(describeError(error));
    }
  }

  function toggleEditor() {
    const next = !isEditor;
    document.cookie = next
      ? 'demo_editor=1; path=/; SameSite=Lax'
      : 'demo_editor=; path=/; Max-Age=0; SameSite=Lax';
    setIsEditor(next);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 font-sans text-slate-900 sm:px-6 lg:px-8">
      <div className="mb-10 space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">SSR RPC Bridge</h1>
        <p className="text-slate-500">
          Client component → Server Action → real API. The backend URL and paths never reach the
          browser. Watch the Network tab: only <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm text-slate-800">POST /</code>.
        </p>
      </div>

      <div className="space-y-6">
        {/* Section 1 */}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
            <h2 className="font-semibold text-slate-800">
              1 · Direct read — <code className="text-sm font-normal text-slate-600">api.products.getProductById</code>
            </h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                ID:
                <input
                  type="number"
                  value={productId}
                  onChange={(e) => setProductId(Number(e.target.value))}
                  className="w-20 rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-shadow"
                />
              </label>
              <button
                onClick={fetchDirect}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                Fetch product
              </button>
              <button
                onClick={callForbidden}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                Try forbidden (deleteProduct)
              </button>
            </div>
            <p className="text-xs text-slate-500">
              The returned product has no <code className="rounded bg-slate-100 px-1 py-0.5">images</code> — redacted by <code className="rounded bg-slate-100 px-1 py-0.5">transformResult</code>.
            </p>
            <pre className="max-h-60 overflow-x-auto rounded-lg bg-slate-50 p-4 font-mono text-sm text-slate-800 shadow-inner border border-slate-100">
              {direct}
            </pre>
          </div>
        </section>

        {/* Section 2 */}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
            <h2 className="font-semibold text-slate-800">
              2 · Direct write + authz
            </h2>
            <div className="flex items-center gap-3 text-sm">
              <span className="flex items-center gap-1.5">
                Editor session: 
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${isEditor ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                  {isEditor ? 'ON' : 'OFF'}
                </span>
              </span>
              <button
                onClick={toggleEditor}
                className="text-indigo-600 hover:text-indigo-700 font-medium hover:underline"
              >
                {isEditor ? 'Sign out' : 'Become editor'}
              </button>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <button
              onClick={addDirect}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Add a product
            </button>
            <p className="text-xs text-slate-500">
              With editor OFF the <code className="rounded bg-slate-100 px-1 py-0.5">authorize</code> hook denies the write. Turn it ON, then add.
            </p>
            <pre className="overflow-x-auto rounded-lg bg-slate-50 p-4 font-mono text-sm text-slate-800 shadow-inner border border-slate-100">
              {writeResult || '—'}
            </pre>
          </div>
        </section>

        {/* Section 5 */}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
            <h2 className="font-semibold text-slate-800">5 · Batching — three reads, one round-trip</h2>
          </div>
          <div className="p-6 space-y-4">
            <button
              onClick={fetchBatch}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Fetch #1, #2, #3 together
            </button>
            <p className="text-xs text-slate-500">
              The browser client coalesces same-tick calls; the server validates each sub-call individually.
            </p>
            <pre className="overflow-x-auto rounded-lg bg-slate-50 p-4 font-mono text-sm text-slate-800 shadow-inner border border-slate-100">
              {batchResult || '—'}
            </pre>
          </div>
        </section>

        {/* Section 6 */}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
            <h2 className="font-semibold text-slate-800">6 · TanStack Query</h2>
          </div>
          <div className="p-6 space-y-4">
            <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
              Search terms:
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                className="w-48 rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-shadow"
              />
            </label>
            <div className="min-h-[24px] text-sm">
              {search.isPending && <p className="text-slate-500 animate-pulse">Loading matches…</p>}
              {search.isError && <p className="text-red-600 font-medium">{describeError(search.error)}</p>}
              {search.data && (
                <p className="text-slate-700 bg-indigo-50 text-indigo-900 px-3 py-2 rounded-md inline-block">
                  <span className="font-semibold">{search.data.products.length}</span> products match “{term}”.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Section 7 */}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
            <h2 className="font-semibold text-slate-800">7 · TanStack Mutation</h2>
          </div>
          <div className="p-6 space-y-4">
            <button
              disabled={addMutation.isPending}
              onClick={() =>
                addMutation.mutate({ body: { title: `Gizmo-${Date.now() % 1000}`, price: 4.99 } })
              }
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {addMutation.isPending ? 'Adding…' : 'Add via mutation (needs editor)'}
            </button>
            <div className="min-h-[24px] text-sm">
              {addMutation.isError && (
                <p className="text-red-600 font-medium">{describeError(addMutation.error)}</p>
              )}
              {addMutation.isSuccess && (
                <p className="text-emerald-700 font-medium bg-emerald-50 px-3 py-2 rounded-md inline-block">
                  ✓ Added — search query invalidated & refetched.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>

      <p className="mt-8 text-center text-sm text-slate-500">
        See <a href="/http" className="text-indigo-600 hover:underline">/http</a> for the generic <code className="px-1">httpTransport</code> variant and{' '}
        <a href="/server" className="text-indigo-600 hover:underline">/server</a> for direct server-side usage.
      </p>
    </main>
  );
}
