/**
 * TanStack Query integration over the SSR RPC bridge.
 *
 * It wraps the *browser* RPC client (`./rpc-client`) with the paths-stripped
 * `rpcModules` descriptor (`./types/generated/api.rpc`) — which carries only the
 * HTTP verb + `hasPathParams`, never a backend path. So the usual ergonomics
 * work client-side with zero path leakage:
 *
 *   useQuery(q.pet.queryOptions.findPetsByStatus({ status: 'available' }))
 *
 * Query keys stay stable & hierarchical: ['developerEhsan', 'pet', 'findPetsByStatus', params].
 */
import { createQueryIntegration } from '@developerehsan/api-client-query/react';
import { api } from './rpc-client';
import { rpcModules } from './types/generated/api.rpc';

export const q = createQueryIntegration(api, {
  modules: rpcModules,
});
