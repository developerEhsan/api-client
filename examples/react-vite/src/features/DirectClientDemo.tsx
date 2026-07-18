import { ApiError } from '@developerehsan/api-client';
/**
 * DIRECT CLIENT USAGE
 * -------------------
 * Call the typed client straight from components. Every method is fully typed
 * from the OpenAPI spec — inputs are checked, results are inferred:
 *
 *   api.products.searchProducts({ q, limit })  -> Promise<ProductList>
 *   api.products.getProductById({ id })         -> Promise<Product>
 *
 * Shows: typed query params, typed path params, loading/error states, typed
 * error handling (ApiError with a real HTTP status), and the debounce-cancel
 * window (a newer keystroke auto-aborts the previous in-flight search).
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Panel, Spinner, StatusBadge } from '../components/ui';
import { api } from '../lib/api/api.config';
import type { Product } from '../lib/api/types/generated/api.types';

export function DirectClientDemo() {
  const [term, setTerm] = useState('phone');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Product | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    const started = performance.now();
    try {
      // Typed query params. A newer search within the 300ms `dedupeWindow`
      // auto-cancels the previous in-flight one (see api.config.ts) — the
      // AbortError is swallowed here so only the latest result wins.
      const result = await api.products.searchProducts({ q, limit: 12 });
      setProducts(result.products);
      setElapsed(Math.round(performance.now() - started));
    } catch (err) {
      if (err instanceof ApiError && err.name === 'AbortError') return; // superseded
      setError(err instanceof ApiError ? `${err.status ?? ''} ${err.message}` : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(term);
  }, [term, load]);

  const openDetail = useCallback(async (id: number) => {
    try {
      // Path param `{id}` is typed and required (a wrong key is a TS error).
      const product = await api.products.getProductById({ id });
      setSelected(product);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status ?? ''} ${err.message}` : String(err));
    }
  }, []);

  return (
    <Panel
      title="Search products (direct typed client)"
      subtitle="api.products.searchProducts({ q }) → ProductList. Type quickly: earlier in-flight searches auto-cancel (300ms debounce window)."
    >
      <div className="toolbar">
        <label>
          Search&nbsp;
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="phone, laptop…"
          />
        </label>
        <Button onClick={() => load(term)}>Reload</Button>
        {loading ? <Spinner /> : null}
        {elapsed !== null ? <span className="muted">loaded in {elapsed} ms</span> : null}
      </div>

      {error ? <div className="alert">{error}</div> : null}

      <div className="grid">
        {products.map((p) => (
          <button key={p.id} type="button" className="card" onClick={() => openDetail(p.id)}>
            <div className="card__title">
              {p.title} <StatusBadge status={p.category} />
            </div>
            <div className="muted">
              #{p.id} · ${p.price}
            </div>
            {p.brand ? <div className="chip">{p.brand}</div> : null}
          </button>
        ))}
        {!loading && products.length === 0 ? (
          <p className="muted">No products for “{term}”.</p>
        ) : null}
      </div>

      {selected ? (
        <div className="detail">
          <div className="detail__head">
            <strong>{selected.title}</strong> <StatusBadge status={selected.category} />
            <Button className="btn--ghost" onClick={() => setSelected(null)}>
              close
            </Button>
          </div>
          <pre className="code">{JSON.stringify(selected, null, 2)}</pre>
        </div>
      ) : null}
    </Panel>
  );
}
