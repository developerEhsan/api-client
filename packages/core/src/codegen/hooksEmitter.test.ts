/**
 * React Query hooks emitter tests (E5): GET -> useQuery, paginated GET adds a
 * useInfinite variant, other verbs -> useMutation; names match api.modules.ts.
 */
import { describe, expect, it } from 'vitest';
import { emitReactQueryHooks } from './hooksEmitter';
import { parseOpenApi } from './parser';

const DOC = {
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0.0' },
  paths: {
    '/pet/{petId}': {
      get: {
        operationId: 'getPetById',
        tags: ['pet'],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/pet': {
      get: {
        operationId: 'listPets',
        tags: ['pet'],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'ok' } },
      },
      post: { operationId: 'addPet', tags: ['pet'], responses: { '200': { description: 'ok' } } },
    },
  },
};

describe('emitReactQueryHooks', () => {
  const ast = parseOpenApi(DOC);
  const src = emitReactQueryHooks(ast, { integrationImport: './query' });

  it('imports the hooks and the integration', () => {
    expect(src).toContain(
      'import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query"',
    );
    expect(src).toContain('import { q } from "./query"');
  });

  it('emits a useQuery hook for a GET operation', () => {
    expect(src).toContain('export function usePetGetPetById(');
    expect(src).toContain(
      'return useQuery({ ...q.pet.queryOptions.getPetById(params), ...options })',
    );
  });

  it('emits a useMutation hook for a non-GET operation', () => {
    expect(src).toContain('export function usePetAddPet(');
    expect(src).toContain('return useMutation(q.pet.mutationOptions.addPet(options))');
  });

  it('emits an infinite-query variant for a paginated GET', () => {
    expect(src).toContain('export function usePetListPets(');
    expect(src).toContain('export function usePetListPetsInfinite(');
    expect(src).toContain('useInfiniteQuery(q.pet.infiniteQueryOptions.listPets(params))');
  });

  it('honors a custom react-query import', () => {
    const custom = emitReactQueryHooks(ast, { reactQueryImport: '@tanstack/solid-query' });
    expect(custom).toContain('from "@tanstack/solid-query"');
  });
});
