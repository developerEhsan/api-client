/**
 * TanStack Query integration.
 *
 * `createQueryIntegration(client, { modules })` produces, per module, typed
 * factories you feed straight into React Query hooks:
 *
 *   useQuery(q.pet.queryOptions.findPetsByStatus({ status: 'available' }))
 *   useMutation(q.pet.mutationOptions.addPet())
 *
 * It reuses the SAME `api` client, so every call still flows through the full
 * pipeline (cache, dedup, retry, auth). Query keys are stable & hierarchical:
 *   ['developerEhsan', 'pet', 'findPetsByStatus', params]
 */
import { createQueryIntegration } from "@developerEhsan/api-client-query/react";
import { api } from "./api.config";
import { generatedModules } from "./types/generated/api.modules";

// Fully typed end-to-end — no cast. Passing the typed `api` plus the generated
// (`as const`) descriptor map lets the integration infer, per method, the input
// and response types and route GET vs write methods to queryOptions vs
// mutationOptions. So `q.pet.queryOptions.findPetsByStatus({ status: 'available' })`
// is typed, and `q.store.mutationOptions.placeOrder()` too.
export const q = createQueryIntegration(api, {
  modules: generatedModules,
});
