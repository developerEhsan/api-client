'use client';

import { q } from '@/lib/api/query';
import { api } from '@/lib/api/rpc-client';
import type { ProductInput } from '@/lib/api/types/generated/api.types';
import { ApiError } from '@developerehsan/api-client/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { useState } from 'react';

const box: React.CSSProperties = {
  background: '#f4f4f4',
  padding: 12,
  borderRadius: 6,
  overflowX: 'auto',
  fontSize: 13,
};
const section: React.CSSProperties = {
  marginTop: 28,
  paddingTop: 16,
  borderTop: '1px solid #e5e5e5',
};

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

  // 6. TanStack Query, routed through the bridge via the paths-stripped descriptor.
  const search = useQuery(q.products.queryOptions.searchProducts({ q: term }));

  // 7. TanStack Mutation → adds a product, then invalidates the search query.
  const addMutation = useMutation(
    q.products.mutationOptions.addProduct({
      onSuccess: () => q.products.invalidateQueries(queryClient),
    }),
  );

  // 1. Direct read (with cancellation support — scenario 3).
  async function fetchDirect() {
    setDirect('Loading…');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000); // auto-cancel after 8s
    try {
      const product = await api.products.getProductById({ id: productId }, { signal: controller.signal });
      // `images` will be absent — stripped by the handler's transformResult.
      setDirect(JSON.stringify(product, null, 2));
    } catch (error) {
      setDirect(describeError(error));
    } finally {
      clearTimeout(timer);
    }
  }

  // 2. Direct write — denied unless the editor cookie is set.
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

  // 4. Uniform denial — `deleteProduct` exists on the client TYPE (the bridge
  // mirrors the whole API surface), but is NOT in the server `expose` allowlist,
  // so at runtime it is denied with the same generic error as an unknown method.
  async function callForbidden() {
    try {
      await api.products.deleteProduct({ id: productId });
      setDirect('(unexpected) call succeeded');
    } catch (error) {
      setDirect(`Denied as expected → ${describeError(error)}`);
    }
  }

  // 5. Batching — three calls in the same tick coalesce into one round-trip.
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
    // Same-origin cookie → sent with both the Server Action and /api/rpc calls,
    // so the handler's `authorize` can read it. A real session cookie should be
    // httpOnly (this demo toggles it from JS only for illustration).
    document.cookie = next
      ? 'demo_editor=1; path=/; SameSite=Lax'
      : 'demo_editor=; path=/; Max-Age=0; SameSite=Lax';
    setIsEditor(next);
  }

  return (
    <main
      style={{ maxWidth: 680, margin: '40px auto', fontFamily: 'system-ui', padding: '0 16px' }}
    >
      <h1>SSR RPC bridge</h1>
      <p style={{ color: '#666' }}>
        Client component → Server Action → real API. The backend URL and paths never reach the
        browser. Watch the Network tab: only <code>POST /</code>.
      </p>

      <section style={section}>
        <h2>
          1 · Direct read — <code>api.products.getProductById</code>
        </h2>
        <label>
          id:{' '}
          <input
            type="number"
            value={productId}
            onChange={(e) => setProductId(Number(e.target.value))}
            style={{ width: 80 }}
          />
        </label>{' '}
        <button onClick={fetchDirect}>Fetch product</button>{' '}
        <button onClick={callForbidden}>Try forbidden (deleteProduct)</button>
        <p style={{ color: '#888', fontSize: 12 }}>
          The returned product has no <code>images</code> — redacted by <code>transformResult</code>.
        </p>
        <pre style={box}>{direct}</pre>
      </section>

      <section style={section}>
        <h2>
          2 · Direct write + authorization — <code>api.products.addProduct</code>
        </h2>
        <p style={{ fontSize: 13 }}>
          Editor session: <strong>{isEditor ? 'ON' : 'OFF'}</strong>{' '}
          <button onClick={toggleEditor}>{isEditor ? 'Sign out' : 'Become editor'}</button>
        </p>
        <button onClick={addDirect}>Add a product</button>
        <p style={{ color: '#888', fontSize: 12 }}>
          With editor OFF the <code>authorize</code> hook denies the write (uniform error). Turn it
          ON, then add.
        </p>
        <pre style={box}>{writeResult || '—'}</pre>
      </section>

      <section style={section}>
        <h2>5 · Batching — three reads, one round-trip</h2>
        <button onClick={fetchBatch}>Fetch #1, #2, #3 together</button>
        <p style={{ color: '#888', fontSize: 12 }}>
          The browser client (<code>{'{ batch: true }'}</code>) coalesces same-tick calls; the
          server validates each sub-call individually.
        </p>
        <pre style={box}>{batchResult || '—'}</pre>
      </section>

      <section style={section}>
        <h2>
          6 · TanStack Query — <code>q.products.queryOptions.searchProducts</code>
        </h2>
        <label>
          search:{' '}
          <input value={term} onChange={(e) => setTerm(e.target.value)} style={{ width: 160 }} />
        </label>
        {search.isPending && <p>Loading…</p>}
        {search.isError && <p style={{ color: 'crimson' }}>{describeError(search.error)}</p>}
        {search.data && (
          <p>
            {search.data.products.length} products match “{term}”.
          </p>
        )}
      </section>

      <section style={section}>
        <h2>
          7 · TanStack Mutation — <code>q.products.mutationOptions.addProduct</code>
        </h2>
        <button
          disabled={addMutation.isPending}
          onClick={() =>
            addMutation.mutate({ body: { title: `Gizmo-${Date.now() % 1000}`, price: 4.99 } })
          }
        >
          {addMutation.isPending ? 'Adding…' : 'Add via mutation (needs editor)'}
        </button>
        {addMutation.isError && (
          <p style={{ color: 'crimson' }}>{describeError(addMutation.error)}</p>
        )}
        {addMutation.isSuccess && <p>Added — search query invalidated & refetched.</p>}
      </section>

      <p style={{ ...section, color: '#888', fontSize: 13 }}>
        See <a href="/http">/http</a> for the generic <code>httpTransport</code> variant and{' '}
        <a href="/server">/server</a> for direct server-side usage (no bridge needed there).
      </p>
    </main>
  );
}
