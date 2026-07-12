/**
 * Vue Query (v5) entry point — `@developerEhsan/api-client-query/vue`.
 *
 * The generated option objects are consumed directly by `useQuery`,
 * `useMutation`, and `useInfiniteQuery`:
 *
 *   const q = useQuery(api.invoices.queryOptions.list({ page: 1 }))
 *   const m = useMutation(api.invoices.mutationOptions.create({
 *     onSuccess: () => integration.invoices.invalidateQueries(queryClient),
 *   }))
 */
export { createQueryIntegration } from './core/createIntegration'
export { moduleKey, methodKey } from './core/queryKeys'
export type {
  QueryIntegration,
  ModuleIntegration,
  TypedQueryIntegration,
  TypedModuleIntegration,
  IntegrationConfig,
  MethodDescriptor,
  ModuleDescriptor,
  QueryKey,
  QueryClientLike,
} from './core/types'
