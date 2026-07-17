/**
 * Build the framework-agnostic TanStack Query integration from a client and a
 * descriptor map. Produces per-module `queryOptions` / `mutationOptions` /
 * `infiniteQueryOptions` factories, query-key helpers, and an
 * `invalidateQueries` helper (spec §7, 6.10).
 */
import { methodKey, moduleKey } from './queryKeys';
import type {
  ClientLike,
  GeneratedInfiniteQueryOptions,
  GeneratedMutationOptions,
  GeneratedQueryOptions,
  IntegrationConfig,
  MethodDescriptor,
  ModuleDescriptor,
  ModuleIntegration,
  QueryClientLike,
  QueryIntegration,
  TypedQueryIntegration,
} from './types';

const QUERY_METHODS = new Set(['GET', 'HEAD']);

/** Best-effort next-page extraction for infinite queries when none is configured. */
function defaultGetNextPageParam(lastPage: unknown): unknown {
  if (typeof lastPage !== 'object' || lastPage === null) return undefined;
  const p = lastPage as Record<string, unknown>;
  const candidate = p['nextCursor'] ?? p['next_cursor'] ?? p['nextPage'] ?? p['next'] ?? undefined;
  if (candidate !== undefined && candidate !== null) return candidate;
  // `{ hasMore: false }` conventions terminate pagination.
  if (p['hasMore'] === false || p['has_more'] === false) return undefined;
  return undefined;
}

/** Whether a query should be enabled given the params it was called with (Q4). */
function computeEnabled(descriptor: MethodDescriptor, params: unknown): boolean {
  if (params === null) return false; // explicit skip sentinel
  if (params === undefined) {
    // Undefined params disable a query only when the endpoint needs them
    // (path templates with `{...}`); parameterless endpoints stay enabled.
    // `rpcModules` omit `path` and carry `hasPathParams` instead.
    const needsPathParams =
      descriptor.path !== undefined
        ? descriptor.path.includes('{')
        : descriptor.hasPathParams === true;
    return !needsPathParams;
  }
  return true;
}

/**
 * Build the TanStack Query integration from an API client and a descriptor map.
 *
 * @example
 * import { createClient } from './generated'
 * import { createQueryIntegration } from '@developerehsan/api-client-query'
 * import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
 *
 * const client = createClient({ baseURL: 'https://petstore3.swagger.io/api/v3' })
 * const q = createQueryIntegration(client, { modules })
 *
 * // query
 * const { data } = useQuery(q.pet.queryOptions.findPetsByStatus({ status: 'available' }))
 *
 * // mutation with cache invalidation
 * const queryClient = useQueryClient()
 * const add = useMutation(
 *   q.pet.mutationOptions.addPet({ onSuccess: () => q.pet.invalidateQueries(queryClient) }),
 * )
 */
export function createQueryIntegration<Client, Mods extends Record<string, ModuleDescriptor>>(
  client: Client,
  config: Omit<IntegrationConfig, 'modules'> & { modules: Mods },
): TypedQueryIntegration<Client, Mods>;
export function createQueryIntegration(
  client: ClientLike,
  config: IntegrationConfig,
): QueryIntegration;
export function createQueryIntegration(
  clientArg: unknown,
  config: IntegrationConfig,
): QueryIntegration {
  const client = clientArg as ClientLike;
  const getNextPageParam = config.getNextPageParam ?? defaultGetNextPageParam;
  const pageParamName = config.pageParamName ?? 'cursor';
  const integration: QueryIntegration = {};

  for (const [moduleName, methods] of Object.entries(config.modules)) {
    const callMethod = (
      methodName: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<unknown> => {
      const mod = client[moduleName];
      const fn = mod?.[methodName];
      if (typeof fn !== 'function') {
        return Promise.reject(
          new Error(`Method "${moduleName}.${methodName}" is not available on the client.`),
        );
      }
      return fn(params, signal ? { signal } : undefined);
    };

    const queryOptions: ModuleIntegration['queryOptions'] = {};
    const mutationOptions: ModuleIntegration['mutationOptions'] = {};
    const infiniteQueryOptions: ModuleIntegration['infiniteQueryOptions'] = {};

    for (const [methodName, descriptor] of Object.entries(methods)) {
      if (QUERY_METHODS.has(descriptor.method)) {
        queryOptions[methodName] = (params?: unknown): GeneratedQueryOptions<unknown> => ({
          queryKey: methodKey(moduleName, methodName, params),
          queryFn: (ctx) => callMethod(methodName, params, ctx.signal),
          enabled: computeEnabled(descriptor, params),
        });

        if (descriptor.isPaginated) {
          infiniteQueryOptions[methodName] = (
            params?: unknown,
          ): GeneratedInfiniteQueryOptions<unknown> => ({
            queryKey: methodKey(moduleName, `${methodName}:infinite`, params),
            queryFn: (ctx) => {
              const merged =
                typeof params === 'object' && params !== null
                  ? { ...(params as Record<string, unknown>), [pageParamName]: ctx.pageParam }
                  : { [pageParamName]: ctx.pageParam };
              return callMethod(methodName, merged, ctx.signal);
            },
            initialPageParam: undefined,
            getNextPageParam,
            enabled: computeEnabled(descriptor, params),
          });
        }
      } else {
        mutationOptions[methodName] = (opts): GeneratedMutationOptions<unknown, unknown> => {
          const generated: GeneratedMutationOptions<unknown, unknown> = {
            mutationKey: methodKey(moduleName, methodName),
            mutationFn: (vars: unknown) => callMethod(methodName, vars),
          };
          if (opts?.onSuccess) generated.onSuccess = opts.onSuccess;
          if (opts?.onError) generated.onError = opts.onError;
          if (opts?.onMutate) generated.onMutate = opts.onMutate;
          return generated;
        };
      }
    }

    integration[moduleName] = {
      queryOptions,
      mutationOptions,
      infiniteQueryOptions,
      keys: {
        all: moduleKey(moduleName),
        method: (method: string, params?: unknown) => methodKey(moduleName, method, params),
      },
      invalidateQueries: (queryClient: QueryClientLike, method?: string) =>
        queryClient.invalidateQueries({
          queryKey: method ? [moduleName, method] : moduleKey(moduleName),
        }),
    };
  }

  return integration;
}
