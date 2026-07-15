/**
 * TanStack Query factory shapes. Phase 5 implements the generators; these types
 * are defined in Phase 1 so the core surface is stable.
 */

export type QueryKey = readonly ['developerEhsan', string, string, ...unknown[]];

export type QueryOptionsFactory<TParams, TData> = (params: TParams) => {
  queryKey: QueryKey;
  queryFn: (ctx: { signal?: AbortSignal }) => Promise<TData>;
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
  retry?: number | ((failureCount: number, error: unknown) => boolean);
  select?: (data: TData) => unknown;
};

export type MutationOptionsFactory<TVars, TData> = (opts?: {
  onSuccess?: (data: TData, vars: TVars) => void | Promise<void>;
  onError?: (error: unknown, vars: TVars) => void | Promise<void>;
  onMutate?: (vars: TVars) => unknown;
}) => {
  mutationKey: QueryKey;
  mutationFn: (vars: TVars) => Promise<TData>;
};

export type InfiniteQueryOptionsFactory<TParams, TData> = (params: TParams) => {
  queryKey: QueryKey;
  queryFn: (ctx: { pageParam: unknown; signal?: AbortSignal }) => Promise<TData>;
  initialPageParam: unknown;
  getNextPageParam: (lastPage: TData) => unknown;
};
