import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
/**
 * TANSTACK QUERY USAGE
 * --------------------
 * The same typed client, driven through React Query. Per module you get
 * `queryOptions`, `infiniteQueryOptions` (for paginated GETs), and
 * `mutationOptions`:
 *
 *   useInfiniteQuery(q.products.infiniteQueryOptions.listProducts({ limit: 8 }))
 *   useMutation(q.products.mutationOptions.addProduct({ onSuccess: … }))
 *
 * React Query handles caching/refetch/pagination state; the api client dedupes
 * at the network level and adds retries/timeouts. Query keys are stable, so
 * invalidation after a mutation refetches automatically.
 */
import { useState } from 'react';
import { Button, Panel, Spinner, StatusBadge } from '../components/ui';
import { q } from '../lib/api/query';
import type { Product, ProductList } from '../lib/api/types/generated/api.types';

export function TanstackDemo() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('Demo Widget');

  // INFINITE QUERY — paginated GET, paged by `skip` (configured in query.ts).
  const list = useInfiniteQuery(q.products.infiniteQueryOptions.listProducts({ limit: 8 }));

  // MUTATION — create a product, then invalidate the list so it refetches.
  const addProduct = useMutation(
    q.products.mutationOptions.addProduct({
      onSuccess: () => {
        // Invalidate every 'products' query for this integration.
        void q.products.invalidateQueries(queryClient);
      },
    }),
  );

  const pages = (list.data?.pages as ProductList[] | undefined) ?? [];
  const products: Product[] = pages.flatMap((p) => p.products);
  const total = pages[0]?.total ?? 0;

  return (
    <Panel
      title="Infinite list & create (TanStack Query)"
      subtitle="useInfiniteQuery pages through products by skip; useMutation creates one and invalidates the list."
    >
      <div className="toolbar">
        {list.isFetching ? <Spinner /> : null}
        <span className="muted">
          {products.length} of {total} loaded
        </span>
      </div>

      <div className="toolbar">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New product title" />
        <Button
          disabled={addProduct.isPending}
          onClick={() =>
            // The mutation's variables are the operation input — here the `body`.
            addProduct.mutate({ body: { title, price: 9.99, category: 'demo' } })
          }
        >
          {addProduct.isPending ? 'Adding…' : 'Add product (addProduct)'}
        </Button>
        {addProduct.isSuccess ? <span className="muted">created ✓ (list refetched)</span> : null}
      </div>

      {addProduct.isError ? (
        <div className="alert">addProduct failed: {String((addProduct.error as Error).message)}</div>
      ) : null}
      {list.isError ? <div className="alert">{String((list.error as Error).message)}</div> : null}

      <div className="grid">
        {products.map((p) => (
          <div key={p.id} className="card card--static">
            <div className="card__title">
              {p.title} <StatusBadge status={p.category} />
            </div>
            <div className="muted">#{p.id} · ${p.price}</div>
          </div>
        ))}
      </div>

      <div className="toolbar">
        <Button
          disabled={!list.hasNextPage || list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage
            ? 'Loading…'
            : list.hasNextPage
              ? 'Load more'
              : 'All products loaded'}
        </Button>
      </div>
    </Panel>
  );
}
