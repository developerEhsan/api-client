/**
 * The single API client for the whole app. Import `api` anywhere.
 *
 * This wires together the two things the codegen produced from the Petstore
 * OpenAPI spec:
 *   - `OperationsMap` (a TYPE)  from ./types/generated/api.types.ts
 *   - `generatedModules` (a VALUE) from ./types/generated/api.modules.ts
 *
 * `createTypedClient<OperationsMap>(config, generatedModules)` turns them into a
 * fully-typed, autocompleting client:
 *
 *   api.pet.getPetById({ petId: 1 })   // -> Promise<Pet>, fully inferred
 *   api.pet.findPetsByStatus({ status: 'available' })   // -> Promise<Pet[]>
 *   api.store.getInventory()           // -> Promise<Record<string, number>>
 *
 * Regenerate types/modules with:
 *   npx @developerehsan/api-client generate \
 *     --input ./src/lib/api/openapi.json \
 *     --output ./src/lib/api/types/generated
 */
import { createModuleDefiner, createTypedClient } from '@developerehsan/api-client';
import { generatedModules } from './types/generated/api.modules';
import type { OperationsMap } from './types/generated/api.types';

// Bound once to the generated spec. Pass the module name first and you get
// reliable autocomplete of that module's methods + their input types, while
// your return values stay whatever you return.
const defineModule = createModuleDefiner<OperationsMap, typeof generatedModules>();

export const api = createTypedClient<OperationsMap>()(
  {
    // Petstore v3 lives under /api/v3 — the spec paths (/pet, /store, …) are
    // appended to this base.
    baseURL: 'https://petstore3.swagger.io/api/v3',

    // Dev logging prints each request/response to the console. Response
    // validation checks bodies against the loaded schema (loose = warn only).
    dev: { logging: true, validateResponses: true },

    openapi: {
      mode: 'runtime',
      // Fetched in the background; powers response validation + drift detection.
      runtimeURL: 'https://petstore3.swagger.io/api/v3/openapi.json',
      validation: { enabled: true, mode: 'loose' },
    },

    // Pipeline defaults for the whole app.
    http: {
      timeout: 12_000,
      retry: { attempts: 3, backoff: 'exponential', baseDelay: 400 },
      queue: { concurrency: 6 },
    },

    // GET responses are cached; stale entries are served instantly then
    // revalidated in the background.
    cache: { strategy: 'stale-while-revalidate', ttl: 30_000 },

    // A newer search within 300ms auto-cancels the previous in-flight one.
    cancellation: { dedupeWindow: 300 },
    modules: {
      auto: true,
      // Plain-object form: reshape the module however you like. The FIRST param
      // of every method is always `ctx` (typed); the exposed `api.pet.<m>()`
      // signature drops it. Custom methods and custom return types WIN over the
      // generated spec — the config is the final source of truth.
      pet: {
        methods: {
          // Custom method (not in the spec) → api.pet.removePet(petid): Promise<{ removePet: boolean }>
          removePet: async (ctx, petid: string) => {
            // ctx.request: type a known `path` to autocomplete it and derive
            // method/pathParams/query/body + response; any string is allowed too.
            await ctx.request({
              method: 'GET',
              path: '/pet/{petId}',
              pathParams: { petId: Number(petid) },
            });
            return { removePet: true };
          },
          // Generated methods you don't override (addPet, getPetById, …) stay
          // available with their spec types. To override one, just add it here —
          // whatever you return becomes its result type (config wins). See
          // `store.getOrderById` below for an override that reshapes the output.
        },
      },
      // Definer form (opt-in): adds method-NAME + input autocomplete for a known
      // module. `defineModule('store', …)` suggests deleteOrder/getInventory/…
      store: defineModule('store', {
        methods: {
          getOrderById: async (_ctx, input) => {
            // `input.orderId` is typed from the generated operation.
            return {
              orderId: input.orderId,
              status: 'delivered',
              note: 'overridden',
            };
          },
        },
      }),
      // Brand-new module: free-form methods, appears as `api.invoices.*`.
      invoices: defineModule('invoices', {
        methods: {
          getInvoices: async () => {
            return { data: [] };
          },
        },
      }),
    },
    // Auth is optional on most Petstore endpoints. Example (uncomment to use):
    // auth: { strategy: "apiKey", getKey: () => "special-key", placement: "header", name: "api_key" },
  },
  generatedModules,
);

export type Api = typeof api;
