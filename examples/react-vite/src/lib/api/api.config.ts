/**
 * The single API client for the whole app. Import `api` anywhere.
 *
 * Backed by the free, CORS-enabled https://dummyjson.com fake API. The codegen
 * turned `openapi.json` into two artifacts this file wires together:
 *   - `OperationsMap` (a TYPE)   from ./types/generated/api.types.ts
 *   - `generatedModules` (a VALUE) from ./types/generated/api.modules.ts
 *
 * `createTypedClient<OperationsMap>()(config, generatedModules)` turns them into
 * a fully-typed, autocompleting client:
 *
 *   api.products.getProductById({ id: 1 })            // -> Promise<Product>
 *   api.products.listProducts({ limit: 10, skip: 0 }) // -> Promise<ProductList>
 *   api.auth.login({ body: { username, password } })  // -> Promise<AuthUser>
 *
 * Regenerate after editing openapi.json (the Vite plugin also does this on
 * dev/build — see vite.config.ts):
 *   npx @developerehsan/api-client generate \
 *     --input ./src/lib/api/openapi.json \
 *     --output ./src/lib/api/types/generated
 */
import { createTypedClient } from '@developerehsan/api-client';
import { generatedModules } from './types/generated/api.modules';
import type { OperationsMap } from './types/generated/api.types';

/**
 * A tiny in-memory token store. `api.auth.login(...)` writes it; the bearer
 * auth strategy below reads it so subsequent calls (e.g. `auth.getCurrentUser`)
 * are authenticated. In a real app persist this to memory/secure storage.
 */
export const tokenStore: { access: string | null } = { access: null };

export const api = createTypedClient<OperationsMap>()(
  {
    // DummyJSON is served from the root; the spec's paths (/products, /auth, …)
    // are appended to this base.
    baseURL: 'https://dummyjson.com',

    // Dev logging prints each request/response to the console; response
    // validation checks bodies against the loaded schema (loose = warn only).
    dev: { logging: true, validateResponses: true },

    openapi: {
      mode: 'runtime',
      validation: { enabled: true, mode: 'loose' },
    },

    // Bearer auth: sends `Authorization: Bearer <token>` when a token exists.
    // `onMissingToken: 'skip'` sends anonymous requests silently when logged out
    // (most DummyJSON endpoints are public; only /auth/me needs the token).
    auth: {
      strategy: 'bearer',
      getToken: () => tokenStore.access,
      onMissingToken: 'skip',
    },

    // Pipeline defaults for the whole app.
    http: {
      timeout: 12_000,
      retry: { attempts: 3, backoff: 'exponential', baseDelay: 400 },
      queue: { concurrency: 6 },
    },

    // GET responses are cached; a stale entry is served instantly, then
    // revalidated in the background.
    cache: { strategy: 'stale-while-revalidate', ttl: 30_000 },

    // A newer call for the same endpoint within 300ms auto-cancels the previous
    // in-flight one (great for search-as-you-type).
    cancellation: { dedupeWindow: 300 },

    // The plain-object `modules` form is the final source of truth: the FIRST
    // param of every method is always the typed `ctx` (stripped from the exposed
    // signature), and your custom methods + return types WIN over the generated
    // spec. (For method-NAME autocomplete on a known module, opt into
    // `createModuleDefiner` — see the README.)
    modules: {
      // Build auto-modules for every tag in the spec (products/users/posts/…).
      auto: true,

      auth: {
        methods: {
          // Custom login that ALSO persists the token, then returns the user.
          // `ctx.request` autocompletes the known path and derives the body type.
          login: async (ctx, body: OperationsMap['login']['body']) => {
            const user = (await ctx.request({ method: 'POST', path: '/auth/login', body })).data as
              OperationsMap['login']['response'];
            tokenStore.access = user.accessToken ?? null;
            return user;
          },
        },
      },

      products: {
        methods: {
          // A custom, non-spec method composed from two requests: fetch a product
          // and its category siblings. Appears as `api.products.getWithSiblings(id)`.
          getWithSiblings: async (ctx, id: number) => {
            const product = (
              await ctx.request({ method: 'GET', path: '/products/{id}', pathParams: { id } })
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
          // Generated methods you don't override (listProducts, getProductById,
          // addProduct, …) remain available with their spec types.
        },
      },

      // A brand-new module (not in the spec): non-HTTP logic via ctx.run, which
      // gets the same queue/dedup/retry/timeout as HTTP calls. Appears as
      // `api.analytics.*`.
      analytics: {
        methods: {
          // ctx.run wraps arbitrary async work with opt-in retry + dedup.
          summarize: async (ctx) => {
            return ctx.run(
              'summarize',
              async () => {
                const top = (
                  await ctx.request({ method: 'GET', path: '/products', query: { limit: 100 } })
                ).data as OperationsMap['listProducts']['response'];
                const avgPrice =
                  top.products.reduce((s, p) => s + p.price, 0) / (top.products.length || 1);
                return { count: top.total, avgPrice: Math.round(avgPrice * 100) / 100 };
              },
              { dedupe: true, retry: { attempts: 2 } },
            );
          },
        },
      },
    },
  },
  generatedModules,
);

export type Api = typeof api;
