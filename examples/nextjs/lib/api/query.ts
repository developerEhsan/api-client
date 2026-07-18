/**
 * TanStack Query integration over the SSR RPC bridge.
 *
 * It wraps the *browser* RPC client (`./rpc-client`) with the paths-stripped
 * `rpcModules` descriptor (`./types/generated/api.rpc`) — which carries only the
 * HTTP verb + `hasPathParams`, never a backend path. So the usual ergonomics
 * work client-side with zero path leakage:
 *
 *   useQuery(q.products.queryOptions.getProductById({ id: 1 }))
 *   useInfiniteQuery(q.products.infiniteQueryOptions.listProducts({ limit: 10 }))
 *
 * Query keys stay stable: ['developerEhsan', 'products', 'listProducts', params].
 */
import { createQueryIntegration } from '@developerehsan/api-client-query/react';
import { api } from './rpc-client';
import { rpcModules } from './types/generated/api.rpc';

interface Page {
  total?: number;
  skip?: number;
  limit?: number;
}

export const q = createQueryIntegration(api, {
  modules: rpcModules,
  // DummyJSON paginates by `skip`; advance it by the page size until `total`.
  pageParamName: 'skip',
  getNextPageParam: (lastPage): number | undefined => {
    const p = lastPage as Page;
    if (typeof p?.skip !== 'number' || typeof p?.limit !== 'number' || typeof p?.total !== 'number')
      return undefined;
    const next = p.skip + p.limit;
    return next < p.total ? next : undefined;
  },
});
