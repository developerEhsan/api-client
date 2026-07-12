/**
 * Framework-agnostic types for the TanStack Query integration. The generated
 * option objects (`{ queryKey, queryFn, ... }`) are plain and consumed
 * identically by React/Vue/Solid Query, so the core is framework-neutral; the
 * per-framework entry points only re-export with framework-appropriate typing.
 */

/** Stable, serializable, hierarchical query key (spec §7.2). */
export type QueryKey = readonly ['developerEhsan', string, string, ...unknown[]]

/** HTTP method as it appears in a generated method descriptor. */
export type DescriptorMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'

/** One endpoint method within a module (mirrors codegen `generatedModules`). */
export interface MethodDescriptor {
  method: DescriptorMethod
  path: string
  isPaginated?: boolean
  operationId?: string
}

export type ModuleDescriptor = Record<string, MethodDescriptor>

export interface IntegrationConfig {
  /** Module -> method descriptors (e.g. the codegen `generatedModules`). */
  modules: Record<string, ModuleDescriptor>
  /**
   * Extract the next page param from a page of data for infinite queries.
   * Defaults to a best-effort probe of common cursor/page fields.
   */
  getNextPageParam?: (lastPage: unknown) => unknown
  /** The pagination param name to inject for infinite queries. Default 'cursor'. */
  pageParamName?: string
}

/**
 * The minimal client shape the integration needs: indexable modules whose
 * methods accept `(params, perCall?)`. Matches the runtime `ApiClient` proxy.
 */
export type ClientLike = Record<
  string,
  Record<string, (params?: unknown, perCall?: { signal?: AbortSignal }) => Promise<unknown>>
>

export interface QueryFnContext {
  signal?: AbortSignal
}

export interface GeneratedQueryOptions<TData> {
  queryKey: QueryKey
  queryFn: (ctx: QueryFnContext) => Promise<TData>
  enabled: boolean
}

export interface GeneratedMutationOptions<TData, TVars> {
  mutationKey: QueryKey
  mutationFn: (vars: TVars) => Promise<TData>
  onSuccess?: (data: TData, vars: TVars) => void | Promise<void>
  onError?: (error: unknown, vars: TVars) => void | Promise<void>
  onMutate?: (vars: TVars) => unknown
}

export interface InfinitePageContext {
  pageParam: unknown
  signal?: AbortSignal
}

export interface GeneratedInfiniteQueryOptions<TData> {
  queryKey: QueryKey
  queryFn: (ctx: InfinitePageContext) => Promise<TData>
  initialPageParam: unknown
  getNextPageParam: (lastPage: TData) => unknown
  enabled: boolean
}

/** A minimal QueryClient surface for invalidation (all frameworks share it). */
export interface QueryClientLike {
  invalidateQueries(filters: { queryKey: readonly unknown[] }): Promise<void>
}

/** Per-module integration surface. */
export interface ModuleIntegration {
  /** Query option factories for the module's GET/HEAD methods. */
  queryOptions: Record<
    string,
    (params?: unknown) => GeneratedQueryOptions<unknown>
  >
  /** Mutation option factories for the module's write methods. */
  mutationOptions: Record<
    string,
    (opts?: {
      onSuccess?: (data: unknown, vars: unknown) => void | Promise<void>
      onError?: (error: unknown, vars: unknown) => void | Promise<void>
      onMutate?: (vars: unknown) => unknown
    }) => GeneratedMutationOptions<unknown, unknown>
  >
  /** Infinite query factories for paginated GET methods. */
  infiniteQueryOptions: Record<
    string,
    (params?: unknown) => GeneratedInfiniteQueryOptions<unknown>
  >
  /** Query-key helpers for this module. */
  keys: {
    all: readonly ['developerEhsan', string]
    method: (method: string, params?: unknown) => QueryKey
  }
  /** Invalidate all queries for this module, or one method. */
  invalidateQueries: (client: QueryClientLike, method?: string) => Promise<void>
}

export type QueryIntegration = Record<string, ModuleIntegration>

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
export type ClientMethod = (
  input?: never,
  perCall?: { signal?: AbortSignal },
) => Promise<unknown>

/** Extract a client method's input (first-arg) type. */
export type MethodInput<F> = F extends (input: infer I, ...rest: never[]) => unknown ? I : unknown

/** Extract a client method's resolved response type. */
export type MethodData<F> = F extends (...args: never[]) => Promise<infer R> ? R : unknown

/** A method whose descriptor marks it a query (GET/HEAD). */
type IsQueryDescriptor<D> = D extends { method: 'GET' | 'HEAD' } ? true : false
type IsPaginatedDescriptor<D> = D extends { isPaginated: true } ? true : false

/** Module method type from the client, or a permissive fallback when absent. */
type MethodOf<Mod, K> = K extends keyof Mod ? Mod[K] : ClientMethod

/** Typed per-module surface derived from the client module `Mod` + descriptors `Descs`. */
export interface TypedModuleIntegration<Mod, Descs extends ModuleDescriptor> {
  queryOptions: {
    [K in keyof Descs as IsQueryDescriptor<Descs[K]> extends true
      ? K
      : never]: (input?: MethodInput<MethodOf<Mod, K>>) => GeneratedQueryOptions<
      MethodData<MethodOf<Mod, K>>
    >
  }
  mutationOptions: {
    [K in keyof Descs as IsQueryDescriptor<Descs[K]> extends true ? never : K]: (opts?: {
      onSuccess?: (
        data: MethodData<MethodOf<Mod, K>>,
        vars: MethodInput<MethodOf<Mod, K>>,
      ) => void | Promise<void>
      onError?: (error: unknown, vars: MethodInput<MethodOf<Mod, K>>) => void | Promise<void>
      onMutate?: (vars: MethodInput<MethodOf<Mod, K>>) => unknown
    }) => GeneratedMutationOptions<MethodData<MethodOf<Mod, K>>, MethodInput<MethodOf<Mod, K>>>
  }
  infiniteQueryOptions: {
    [K in keyof Descs as IsQueryDescriptor<Descs[K]> extends true
      ? IsPaginatedDescriptor<Descs[K]> extends true
        ? K
        : never
      : never]: (
      input?: MethodInput<MethodOf<Mod, K>>,
    ) => GeneratedInfiniteQueryOptions<MethodData<MethodOf<Mod, K>>>
  }
  keys: ModuleIntegration['keys']
  invalidateQueries: ModuleIntegration['invalidateQueries']
}

/** Fully-typed integration: module → typed query/mutation factories. */
export type TypedQueryIntegration<Client, Mods extends Record<string, ModuleDescriptor>> = {
  [M in keyof Mods & string]: TypedModuleIntegration<
    M extends keyof Client ? Client[M] : unknown,
    Mods[M]
  >
}
