/**
 * Framework-agnostic types for the TanStack Query integration. The generated
 * option objects (`{ queryKey, queryFn, ... }`) are plain and consumed
 * identically by React/Vue/Solid Query, so the core is framework-neutral; the
 * per-framework entry points only re-export with framework-appropriate typing.
 *
 * @see {@link https://github.com/developerEhsan/api-client/blob/master/docs/tanstack-query.md}
 */

/**
 * Stable, serializable, hierarchical query key (spec §7.2).
 *
 * @example
 * const key: QueryKey = ['developerEhsan', 'pet', 'findPetsByStatus', { status: 'available' }]
 */
export type QueryKey = readonly ['developerEhsan', string, string, ...unknown[]];

/**
 * HTTP method as it appears in a generated method descriptor.
 *
 * @example
 * const method: DescriptorMethod = 'GET'
 */
export type DescriptorMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/**
 * One endpoint method within a module. Mirrors codegen `generatedModules`, and
 * also accepts the paths-stripped `rpcModules` used behind the SSR bridge: there
 * `path` is absent and `hasPathParams` carries the only bit `computeEnabled`
 * needs, so no backend path string reaches the browser.
 *
 * @example
 * const descriptor: MethodDescriptor = { method: 'GET', path: '/pet/findByStatus' }
 */
export interface MethodDescriptor {
  method: DescriptorMethod;
  /** Full path template. Present in `generatedModules`, absent in `rpcModules`. */
  path?: string;
  /** Whether the path is parameterized (`rpcModules` substitute for `path`). */
  hasPathParams?: boolean;
  isPaginated?: boolean;
  operationId?: string;
}

/**
 * A module's method name -> descriptor map, as produced by codegen.
 *
 * @example
 * const pet: ModuleDescriptor = { findPetsByStatus: { method: 'GET', path: '/pet/findByStatus' } }
 */
export type ModuleDescriptor = Record<string, MethodDescriptor>;

/**
 * Input to `createQueryIntegration`: the descriptor map plus pagination
 * hooks.
 *
 * @example
 * const config: IntegrationConfig = { modules, pageParamName: 'cursor' }
 */
export interface IntegrationConfig {
  /** Module -> method descriptors (e.g. the codegen `generatedModules`). */
  modules: Record<string, ModuleDescriptor>;
  /**
   * Extract the next page param from a page of data for infinite queries.
   * Defaults to a best-effort probe of common cursor/page fields.
   */
  getNextPageParam?: (lastPage: unknown) => unknown;
  /** The pagination param name to inject for infinite queries. Default 'cursor'. */
  pageParamName?: string;
}

/**
 * The minimal client shape the integration needs: indexable modules whose
 * methods accept `(params, perCall?)`. Matches the runtime `ApiClient` proxy.
 *
 * @example
 * const client: ClientLike = { pet: { findPetsByStatus: (params) => fetch('...').then((r) => r.json()) } }
 */
export type ClientLike = Record<
  string,
  Record<string, (params?: unknown, perCall?: { signal?: AbortSignal }) => Promise<unknown>>
>;

/**
 * Context passed to a generated `queryFn`, carrying the query's `AbortSignal`.
 *
 * @example
 * const queryFn = (ctx: QueryFnContext) => fetch('/pet/1', { signal: ctx.signal })
 */
export interface QueryFnContext {
  signal?: AbortSignal;
}

/**
 * A TanStack Query-compatible options object for a GET/HEAD method, as
 * produced by `q.<module>.queryOptions.<method>(input)`.
 *
 * @example
 * const { data } = useQuery(q.pet.queryOptions.findPetsByStatus({ status: 'available' }))
 */
export interface GeneratedQueryOptions<TData> {
  queryKey: QueryKey;
  queryFn: (ctx: QueryFnContext) => Promise<TData>;
  enabled: boolean;
}

/**
 * A TanStack Mutation-compatible options object for a write method, as
 * produced by `q.<module>.mutationOptions.<method>(opts)`.
 *
 * @example
 * const add = useMutation(q.pet.mutationOptions.addPet({ onSuccess: () => console.log('added') }))
 */
export interface GeneratedMutationOptions<TData, TVars> {
  mutationKey: QueryKey;
  mutationFn: (vars: TVars) => Promise<TData>;
  onSuccess?: (data: TData, vars: TVars) => void | Promise<void>;
  onError?: (error: unknown, vars: TVars) => void | Promise<void>;
  onMutate?: (vars: TVars) => unknown;
}

/**
 * Context passed to a generated infinite `queryFn`, carrying the current page
 * param and `AbortSignal`.
 *
 * @example
 * const queryFn = (ctx: InfinitePageContext) => fetch(`/pet?cursor=${ctx.pageParam}`, { signal: ctx.signal })
 */
export interface InfinitePageContext {
  pageParam: unknown;
  signal?: AbortSignal;
}

/**
 * A TanStack `useInfiniteQuery`-compatible options object, as produced by
 * `q.<module>.infiniteQueryOptions.<method>(input)` for paginated GET methods.
 *
 * @example
 * const { data } = useInfiniteQuery(q.pet.infiniteQueryOptions.findPetsByStatus({ status: 'available' }))
 */
export interface GeneratedInfiniteQueryOptions<TData> {
  queryKey: QueryKey;
  queryFn: (ctx: InfinitePageContext) => Promise<TData>;
  initialPageParam: unknown;
  getNextPageParam: (lastPage: TData) => unknown;
  enabled: boolean;
}

/**
 * A minimal QueryClient surface for invalidation (all frameworks share it).
 *
 * @example
 * const queryClient = useQueryClient() satisfies QueryClientLike
 */
export interface QueryClientLike {
  invalidateQueries(filters: { queryKey: readonly unknown[] }): Promise<void>;
}

/**
 * Per-module integration surface returned by `createQueryIntegration` for one
 * module: query/mutation/infinite-query factories, key helpers, and
 * invalidation.
 *
 * @example
 * const pet: ModuleIntegration = q.pet
 */
export interface ModuleIntegration {
  /** Query option factories for the module's GET/HEAD methods. */
  queryOptions: Record<string, (params?: unknown) => GeneratedQueryOptions<unknown>>;
  /** Mutation option factories for the module's write methods. */
  mutationOptions: Record<
    string,
    (opts?: {
      onSuccess?: (data: unknown, vars: unknown) => void | Promise<void>;
      onError?: (error: unknown, vars: unknown) => void | Promise<void>;
      onMutate?: (vars: unknown) => unknown;
    }) => GeneratedMutationOptions<unknown, unknown>
  >;
  /** Infinite query factories for paginated GET methods. */
  infiniteQueryOptions: Record<
    string,
    (params?: unknown) => GeneratedInfiniteQueryOptions<unknown>
  >;
  /** Query-key helpers for this module. */
  keys: {
    all: readonly ['developerEhsan', string];
    method: (method: string, params?: unknown) => QueryKey;
  };
  /** Invalidate all queries for this module, or one method. */
  invalidateQueries: (client: QueryClientLike, method?: string) => Promise<void>;
}

/**
 * The full return value of `createQueryIntegration`: module name -> its
 * {@link ModuleIntegration}.
 *
 * @example
 * const q: QueryIntegration = createQueryIntegration(client, { modules })
 */
export type QueryIntegration = Record<string, ModuleIntegration>;

// ---------------------------------------------------------------------------
// Typed integration surface
//
// When `createQueryIntegration` is called with a typed client (the value from
// `createTypedClient`) plus the generated descriptor map (which, being `as
// const`, preserves each method's HTTP verb + `isPaginated`), the returned
// integration is fully typed: `q.pet.queryOptions.findPetsByStatus(input)`
// infers `input` and the query's `TData`, and GET vs write methods are routed
// to `queryOptions` vs `mutationOptions` at the type level. No cast needed.
// ---------------------------------------------------------------------------

/** A single method as exposed on the typed client: `(input?, perCall?) => Promise<T>`. */
export type ClientMethod = (input?: never, perCall?: { signal?: AbortSignal }) => Promise<unknown>;

/** Extract a client method's input (first-arg) type. */
export type MethodInput<F> = F extends (input: infer I, ...rest: never[]) => unknown ? I : unknown;

/** Extract a client method's resolved response type. */
export type MethodData<F> = F extends (...args: never[]) => Promise<infer R> ? R : unknown;

/** A method whose descriptor marks it a query (GET/HEAD). */
type IsQueryDescriptor<D> = D extends { method: 'GET' | 'HEAD' } ? true : false;
type IsPaginatedDescriptor<D> = D extends { isPaginated: true } ? true : false;

/** Module method type from the client, or a permissive fallback when absent. */
type MethodOf<Mod, K> = K extends keyof Mod ? Mod[K] : ClientMethod;

/**
 * Typed per-module surface derived from the client module `Mod` + descriptors
 * `Descs`. This is what makes `q.pet.queryOptions.findPetsByStatus(input)`
 * infer `input`/`TData` from the real client method, with no cast needed.
 *
 * @example
 * type PetIntegration = TypedModuleIntegration<Client['pet'], Mods['pet']>
 */
export interface TypedModuleIntegration<Mod, Descs extends ModuleDescriptor> {
  queryOptions: {
    [K in keyof Descs as IsQueryDescriptor<Descs[K]> extends true ? K : never]: (
      input?: MethodInput<MethodOf<Mod, K>>,
    ) => GeneratedQueryOptions<MethodData<MethodOf<Mod, K>>>;
  };
  mutationOptions: {
    [K in keyof Descs as IsQueryDescriptor<Descs[K]> extends true ? never : K]: (opts?: {
      onSuccess?: (
        data: MethodData<MethodOf<Mod, K>>,
        vars: MethodInput<MethodOf<Mod, K>>,
      ) => void | Promise<void>;
      onError?: (error: unknown, vars: MethodInput<MethodOf<Mod, K>>) => void | Promise<void>;
      onMutate?: (vars: MethodInput<MethodOf<Mod, K>>) => unknown;
    }) => GeneratedMutationOptions<MethodData<MethodOf<Mod, K>>, MethodInput<MethodOf<Mod, K>>>;
  };
  infiniteQueryOptions: {
    [K in keyof Descs as IsQueryDescriptor<Descs[K]> extends true
      ? IsPaginatedDescriptor<Descs[K]> extends true
        ? K
        : never
      : never]: (
      input?: MethodInput<MethodOf<Mod, K>>,
    ) => GeneratedInfiniteQueryOptions<MethodData<MethodOf<Mod, K>>>;
  };
  keys: ModuleIntegration['keys'];
  invalidateQueries: ModuleIntegration['invalidateQueries'];
}

/**
 * Fully-typed integration: module → typed query/mutation factories. Returned
 * by the typed overload of `createQueryIntegration` when given a typed client
 * and an `as const` descriptor map.
 *
 * @example
 * const q: TypedQueryIntegration<Client, typeof modules> = createQueryIntegration(client, { modules })
 *
 * @see {@link https://github.com/developerEhsan/api-client/blob/master/docs/tanstack-query.md}
 */
export type TypedQueryIntegration<Client, Mods extends Record<string, ModuleDescriptor>> = {
  [M in keyof Mods & string]: TypedModuleIntegration<
    M extends keyof Client ? Client[M] : unknown,
    Mods[M]
  >;
};
