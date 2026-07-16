/**
 * Type-level regression tests for the typed client (B4 harness).
 *
 * These pin the *current, known-good* inference behavior so later type
 * refactors (notably closing the `config.modules` autocomplete gap) cannot
 * silently regress it. They compile-check only — nothing runs. Uses a small
 * inline fixture instead of a generated `api.types.ts` so the assertions are
 * self-contained.
 */
import { describe, expectTypeOf, it } from 'vitest';
import { createModuleDefiner } from './createTypedClient';
import { createTypedClient } from './createTypedClient';

// --- Inline fixture: a two-operation "spec" -------------------------------

interface Pet {
  id: number;
  name: string;
}
interface Order {
  id: number;
  petId: number;
}

/** Mirrors a generated `OperationsMap`. */
interface Ops {
  getPetById: { params: { petId: number }; response: Pet };
  placeOrder: { body: Order; response: Order };
  getInventory: { response: Record<string, number> };
}

/** Mirrors a generated `generatedModules` value (`as const` in real output). */
const descriptors = {
  pet: {
    getPetById: { method: 'GET', path: '/pet/{petId}', operationId: 'getPetById' },
  },
  store: {
    placeOrder: { method: 'POST', path: '/store/order', operationId: 'placeOrder' },
    getInventory: { method: 'GET', path: '/store/inventory', operationId: 'getInventory' },
  },
} as const;

describe('createTypedClient — generated modules', () => {
  const api = createTypedClient<Ops>()(
    { baseURL: 'https://example.test', openapi: { mode: 'runtime' } },
    descriptors,
  );

  it('infers operation input and response for a generated method', () => {
    expectTypeOf(api.pet.getPetById).parameter(0).toMatchTypeOf<{ petId: number } | undefined>();
    expectTypeOf(api.pet.getPetById({ petId: 1 })).resolves.toEqualTypeOf<Pet>();
  });

  it('treats a no-required-input operation as callable with no args', () => {
    expectTypeOf(api.store.getInventory()).resolves.toEqualTypeOf<Record<string, number>>();
  });

  it('routes `body` operations through the `body` key', () => {
    expectTypeOf(api.store.placeOrder).parameter(0).toMatchTypeOf<{ body: Order }>();
    expectTypeOf(api.store.placeOrder({ body: { id: 1, petId: 2 } })).resolves.toEqualTypeOf<Order>();
  });
});

describe('config.modules — source of truth (override + key-stealing regression)', () => {
  it('a custom method return type wins over the generated one', () => {
    const api = createTypedClient<Ops>()(
      {
        baseURL: 'https://example.test',
        openapi: { mode: 'runtime' },
        modules: {
          pet: {
            methods: {
              // Custom return shape must survive and be inferred verbatim.
              getPetById: async (_ctx, id: number) => ({ id, name: 'x', custom: true }),
            },
          },
        },
      },
      descriptors,
    );
    expectTypeOf(api.pet.getPetById).returns.resolves.toEqualTypeOf<{
      id: number;
      name: string;
      custom: boolean;
    }>();
  });

  it('overriding one module does NOT drop the other generated modules (no key-stealing)', () => {
    const api = createTypedClient<Ops>()(
      {
        baseURL: 'https://example.test',
        openapi: { mode: 'runtime' },
        modules: {
          custom: {
            methods: { hello: async () => 'world' as const },
          },
        },
      },
      descriptors,
    );
    // Generated modules remain present and typed alongside the custom one.
    expectTypeOf(api.pet.getPetById({ petId: 1 })).resolves.toEqualTypeOf<Pet>();
    expectTypeOf(api.store.getInventory()).resolves.toEqualTypeOf<Record<string, number>>();
    // The custom module is exposed with its own return type.
    expectTypeOf(api.custom.hello()).resolves.toEqualTypeOf<'world'>();
  });
});

describe('createModuleDefiner — the blessed method-name autocomplete path (B1)', () => {
  const defineModule = createModuleDefiner<Ops, typeof descriptors>();

  it('operation-typed input for a known method; developer return type preserved', () => {
    const store = defineModule('store', {
      methods: {
        placeOrder: async (_ctx, input) => {
          // `input` is operation-typed on the definer path (the autocomplete win).
          expectTypeOf(input).toMatchTypeOf<{ body: Order }>();
          return { queued: true };
        },
      },
    });
    // Return type is the developer's, not Promise<unknown>.
    expectTypeOf(store.methods.placeOrder).returns.resolves.toEqualTypeOf<{ queued: boolean }>();
  });

  it('still allows brand-new methods (free signatures) alongside known ones', () => {
    const store = defineModule('store', {
      methods: {
        // A method not in the operations map keeps a fully free signature —
        // proving the definer hints known names WITHOUT restricting to them.
        summarize: async (_ctx, since: string) => ({ count: 0, since }),
      },
    });
    expectTypeOf(store.methods.summarize).parameter(1).toEqualTypeOf<string>();
  });
});

// NOTE (B1 resolution): the PLAIN-OBJECT `config.modules` form intentionally
// does NOT offer method-name autocomplete for known modules. That looseness is
// what lets a custom method override a generated one with an ARBITRARY signature
// (see the override test above) without TS "stealing" the generated keys. The
// two cannot coexist in one inference position, so operation-aware autocomplete
// is provided via `createModuleDefiner` (tested here) — the documented,
// type-sound path — rather than a fragile intersection hack on the plain object.
