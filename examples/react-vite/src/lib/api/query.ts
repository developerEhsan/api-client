/**
 * TanStack Query integration.
 *
 * `createQueryIntegration(client, { modules })` produces, per module, typed
 * factories you feed straight into React Query hooks:
 *
 *   useQuery(q.products.queryOptions.getProductById({ id: 1 }))
 *   useMutation(q.products.mutationOptions.addProduct())
 *   useInfiniteQuery(q.products.infiniteQueryOptions.listProducts({ limit: 10 }))
 *
 * It reuses the SAME `api` client, so every call still flows through the full
 * pipeline (cache, dedup, retry, auth). Query keys are stable & hierarchical:
 *   ['developerEhsan', 'products', 'listProducts', params]
 */
import { createQueryIntegration } from '@developerehsan/api-client-query/react';
import { api } from './api.config';
import { generatedModules } from './types/generated/api.modules';

/** DummyJSON list envelope: `{ ..., total, skip, limit }`. */
interface Page {
  total?: number;
  skip?: number;
  limit?: number;
}

export const q = createQueryIntegration(api, {
  modules: generatedModules,
  // DummyJSON paginates by `skip` (offset). Each infinite-query page merges the
  // computed `skip` into the request params; `getNextPageParam` advances it by
  // the page size until the total is reached.
  pageParamName: 'skip',
  getNextPageParam: (lastPage: unknown): number | undefined => {
    const p = lastPage as Page;
    if (typeof p?.skip !== 'number' || typeof p?.limit !== 'number' || typeof p?.total !== 'number')
      return undefined;
    const next = p.skip + p.limit;
    return next < p.total ? next : undefined;
  },
});
