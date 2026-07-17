/**
 * Phase 4 D4: `extends: 'auto'` derives module methods from the runtime schema.
 * The spec loads in the background (stubbed fetch); the actual endpoint calls go
 * through the mock adapter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '../errors/ConfigurationError';
import { createMockClient } from '../testing/createMockClient';
import type { ModuleContext } from '../types/module.types';

const SPEC = {
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0.0' },
  paths: {
    '/pet/{petId}': {
      get: { operationId: 'getPetById', tags: ['pet'], responses: { '200': { description: 'ok' } } },
    },
    '/pet': {
      get: { operationId: 'listPets', tags: ['pet'], responses: { '200': { description: 'ok' } } },
    },
  },
};

function stubSpecFetch() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(SPEC), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }) as Response,
  );
}

interface AutoPetApi {
  pet: {
    getPetById: (input?: { pathParams?: { petId: number } }) => Promise<unknown>;
    listPets: (input?: unknown) => Promise<unknown>;
    nope: (input?: unknown) => Promise<unknown>;
    custom: () => Promise<unknown>;
  };
}

afterEach(() => vi.restoreAllMocks());

describe("extends: 'auto' from the runtime schema", () => {
  it('derives methods from the same-named tag and dispatches them', async () => {
    stubSpecFetch();
    const { api, mock } = createMockClient({
      openapi: { mode: 'runtime', runtimeURL: 'https://api.test/openapi.json' },
      modules: { auto: false as const, pet: { extends: 'auto' as const, methods: {} } },
    });
    mock.on('GET', '/pet/1', { data: { id: 1, name: 'Rex' } });

    const res = await (api as unknown as AutoPetApi).pet.getPetById({ pathParams: { petId: 1 } });
    expect(res).toEqual({ id: 1, name: 'Rex' });
    expect(mock.callsTo('GET', '/pet/1')).toHaveLength(1);
  });

  it('a call made before the schema loads still resolves (awaits readiness)', async () => {
    stubSpecFetch();
    const { api, mock } = createMockClient({
      openapi: { mode: 'runtime', runtimeURL: 'https://api.test/openapi.json' },
      modules: { auto: false as const, pet: { extends: 'auto' as const, methods: {} } },
    });
    mock.on('GET', '/pet', { data: [{ id: 1 }] });
    // No await gap: invoke immediately after createClient returns.
    const res = await (api as unknown as AutoPetApi).pet.listPets();
    expect(res).toEqual([{ id: 1 }]);
  });

  it('errors clearly for an auto method absent from the schema', async () => {
    stubSpecFetch();
    const { api } = createMockClient({
      openapi: { mode: 'runtime', runtimeURL: 'https://api.test/openapi.json' },
      modules: { auto: false as const, pet: { extends: 'auto' as const, methods: {} } },
    });
    await expect((api as unknown as AutoPetApi).pet.nope()).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  it('custom methods win over auto-derived ones', async () => {
    stubSpecFetch();
    const { api } = createMockClient({
      openapi: { mode: 'runtime', runtimeURL: 'https://api.test/openapi.json' },
      modules: {
        auto: false as const,
        pet: {
          extends: 'auto' as const,
          methods: {
            custom: async (_ctx: ModuleContext) => 'custom-result',
            // Override the auto getPetById with a custom impl.
            getPetById: async (_ctx: ModuleContext) => 'overridden',
          },
        },
      },
    });
    expect(await (api as unknown as AutoPetApi).pet.custom()).toBe('custom-result');
    expect(await (api as unknown as AutoPetApi).pet.getPetById()).toBe('overridden');
  });
});
