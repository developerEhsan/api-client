import 'server-only';
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
import { createRpcHandler } from '@developerehsan/api-client/server';
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

/**
 * SSR RPC bridge — server side. `rpcHandler` is the single trust boundary: it
 * runs the real `api` (which alone holds the base URL, backend paths, and the
 * OpenAPI document) behind a deny-by-default allowlist. The browser never sees
 * any of those secrets — only the method names it is allowed to call.
 *
 * Every option is typed and hover-documented. `expose` is typed against `Api`,
 * so both module names AND each module's method names autocomplete, and a typo
 * (wrong module or wrong method) is a compile error — try changing "getPetById"
 * to "getPetByIdX" and TypeScript will reject it.
 *
 * This handler wires up ALL the optional hooks so you can see where each belongs:
 *   - `authorize`       — per-call permission (reads open, writes gated).
 *   - `onRequest`       — audit log + a naive rate-limit hook point.
 *   - `transformResult` — redact fields before they cross the wire.
 *   - `onError`         — server-side logging of the full error.
 */
const WRITE_METHODS = new Set(['addPet']);

export const rpcHandler = createRpcHandler(api, {
  // Deny-by-default. Exposes `getPetById`/`findPetsByStatus`/`addPet` on `pet`
  // and `getInventory` on `store`. Everything else the browser tries → uniform
  // "not available". `store: true` would instead expose every store method.
  expose: {
    pet: ['getPetById', 'findPetsByStatus', 'addPet'],
    store: ['getInventory'],
  },

  // Row/role-level permission, checked AFTER the allowlist and BEFORE dispatch.
  // Reads are public; writes require an "editor" session. We read a cookie via
  // `ctx.getCookie` (present on both the Server Action and the /api/rpc route),
  // NOT a client-set header — a header would be trivially spoofable. In a real
  // app, verify a signed session/JWT here instead of mere cookie presence.
  authorize: async (ctx, call) => {
    if (!WRITE_METHODS.has(call.method)) return true; // reads: always allowed
    const editor = await ctx.getCookie?.('demo_editor');
    return editor === '1'; // deny → caller gets the same error as "unknown method"
  },

  // Runs before every dispatch. Throw to reject (rate-limit / quota). Here we
  // just audit; swap in a real limiter (keyed by IP or session) in production.
  onRequest: (_ctx, call) => {
    console.log(`[rpc] ${call.module}.${call.method}`);
  },

  // Project/redact the result before serialization (least privilege). Demo:
  // strip a Pet's `category` before it reaches the browser.
  transformResult: (result, call) => {
    if (call.method === 'getPetById' && result && typeof result === 'object') {
      const safe = { ...(result as Record<string, unknown>) };
      delete safe.category;
      return safe;
    }
    return result;
  },

  // Observe the FULL error server-side (stack, backend URL, etc. stay here);
  // the browser only ever receives the sanitized shape.
  onError: (error, call) => {
    console.error(`[rpc] ${call?.module}.${call?.method} failed:`, error);
  },
});
