import 'server-only';
/**
 * The single (server-only) API client for the whole app, plus the SSR RPC bridge
 * handler. Backed by https://dummyjson.com.
 *
 * The codegen turned `openapi.json` into:
 *   - `OperationsMap` (a TYPE)     from ./types/generated/api.types.ts
 *   - `generatedModules` (a VALUE) from ./types/generated/api.modules.ts
 *
 * `createTypedClient<OperationsMap>()(config, generatedModules)` wires them into
 * a fully-typed client:
 *
 *   api.products.getProductById({ id: 1 })            // -> Promise<Product>
 *   api.products.listProducts({ limit: 10 })          // -> Promise<ProductList>
 *
 * Regenerate types after editing openapi.json (or use the Next integration —
 * see next.config):
 *   npx @developerehsan/api-client generate \
 *     --input ./lib/api/openapi.json --output ./lib/api/types/generated
 */
import { createTypedClient } from '@developerehsan/api-client';
import { createRateLimiter, createRpcHandler } from '@developerehsan/api-client/server';
import { generatedModules } from './types/generated/api.modules';
import type { OperationsMap } from './types/generated/api.types';

export const api = createTypedClient<OperationsMap>()(
  {
    // DummyJSON — the base URL, paths, and OpenAPI doc live ONLY here on the
    // server; the browser (via the RPC bridge) never sees them.
    baseURL: 'https://dummyjson.com',
    dev: { logging: true },
    openapi: { mode: 'runtime', validation: { enabled: true, mode: 'loose' } },
    http: {
      timeout: 12_000,
      retry: { attempts: 3, backoff: 'exponential', baseDelay: 400 },
      queue: { concurrency: 6 },
    },
    hooks: {
      onCacheHit(key) {
        console.log('CACHE HIT', key);
      },
      onRetry(attempt, error) {
        console.log('RETRYING', error, { attempt });
      },
    },
    cache: { strategy: 'stale-while-revalidate', ttl: 30_000 },
    modules: {
      auto: true,
      products: {
        methods: {
          // Custom composed method (config wins): product + category siblings.
          getWithSiblings: async (ctx, id: number) => {
            const product = (
              await ctx.request({
                method: 'GET',
                path: '/products/{id}',
                pathParams: { id },
              })
            ).data as OperationsMap['getProductById']['response'];
            const siblings = (
              await ctx.request({
                method: 'GET',
                path: '/products/search',
                query: { q: product.category ?? '', limit: 5 },
              })
            ).data as OperationsMap['searchProducts']['response'];
            return { product, siblings: siblings.products };
          },
        },
      },
    },
  },
  generatedModules,
);

export type Api = typeof api;

/**
 * A built-in server-side rate limiter (roadmap feature). Wired into the handler
 * `onRequest` below — 30 calls / 10s per session cookie (falling back to a
 * shared bucket). Over budget → a uniform `rate_limited` error (HTTP 429 in the
 * envelope), rehydrated as an `ApiError` on the browser.
 */
const limiter = createRateLimiter({
  windowMs: 10_000,
  max: 30,
  keyFor: async (ctx) => (await ctx.getCookie?.('demo_session')) ?? 'anon',
});

/** Methods that mutate — gated behind an editor cookie by `authorize`. */
const WRITE_METHODS = new Set(['addProduct', 'updateProduct', 'deleteProduct']);

/**
 * SSR RPC bridge — server side. `rpcHandler` is the single trust boundary: it
 * runs the real `api` behind a deny-by-default allowlist. `expose` is typed
 * against `Api`, so module AND method names autocomplete and a typo is a
 * compile error.
 *
 * Wires every optional hook so you can see where each belongs:
 *   - `onRequest`       — the rate limiter (throws to reject over budget).
 *   - `authorize`       — per-call permission (reads open, writes gated).
 *   - `transformResult` — redact fields before they cross the wire.
 *   - `onError`         — server-side logging of the FULL error.
 *
 * `maxBatchSize` bounds RPC batching (the browser coalesces same-tick calls into
 * one round-trip; each sub-call is still validated + authorized individually).
 */
export const rpcHandler = createRpcHandler(api, {
  expose: {
    products: ['getProductById', 'listProducts', 'searchProducts', 'addProduct', 'getWithSiblings'],
    auth: ['login', 'getCurrentUser'],
    users: ['getUserById'],
  },
  maxBatchSize: 10,

  onRequest: limiter.onRequest,

  authorize: async (ctx, call) => {
    if (!WRITE_METHODS.has(call.method)) return true; // reads: always allowed
    const editor = await ctx.getCookie?.('demo_editor');
    return editor === '1'; // deny → same error as "unknown method" (no enumeration)
  },

  // Least-privilege: strip a product's bulky `images` array before it ships.
  transformResult: (result, call) => {
    if (call.method === 'getProductById' && result && typeof result === 'object') {
      const safe = { ...(result as Record<string, unknown>) };
      delete safe.images;
      return safe;
    }
    return result;
  },

  onError: (error, call) => {
    console.error(`[rpc] ${call?.module}.${call?.method} failed:`, error);
  },
});
