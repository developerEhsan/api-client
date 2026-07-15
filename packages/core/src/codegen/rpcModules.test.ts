/**
 * The paths-stripped `rpcModules` artifact must never carry backend path
 * strings — that is the whole point of routing TanStack Query through the SSR
 * bridge. This is the codegen-side leak test.
 */
import { describe, expect, it } from 'vitest';
import type { SchemaAST } from '../types/openapi.types';
import { emitModules, emitRpcModules } from './moduleEmitter';
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
    '/pet/findByStatus': {
      get: {
        operationId: 'findPetsByStatus',
        tags: ['pet'],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/store/inventory': {
      post: {
        operationId: 'addInventory',
        tags: ['store'],
        responses: { '200': { description: 'ok' } },
      },
    },
  },
};

describe('emitRpcModules', () => {
  const ast: SchemaAST = parseOpenApi(DOC);
  const rpcSource = emitRpcModules(ast);

  it('contains no backend path substrings', () => {
    expect(rpcSource).not.toContain('/pet/');
    expect(rpcSource).not.toContain('/store/');
    expect(rpcSource).not.toContain('{petId}');
    expect(rpcSource).not.toContain('path:');
    expect(rpcSource).not.toContain('operationId');
  });

  it('keeps verb, hasPathParams, and isPaginated (what the query layer needs)', () => {
    expect(rpcSource).toContain('method: "GET"');
    expect(rpcSource).toContain('hasPathParams: true'); // /pet/{petId}
    expect(rpcSource).toContain('hasPathParams: false'); // /pet/findByStatus
    expect(rpcSource).toContain('export const rpcModules');
  });

  it('module/method names match the full generatedModules', () => {
    const full = emitModules(ast);
    for (const name of ['getPetById', 'findPetsByStatus', 'addInventory', 'pet', 'store']) {
      expect(full).toContain(name);
      expect(rpcSource).toContain(name);
    }
  });
});
