/**
 * Type-only regression for `docs/manual-types.md` (spec 04): a hand-written
 * `Ops` — never touched by codegen — must produce the exact same inference
 * `createTypedClient` gives a generated `OperationsMap`. Compile-check only.
 */
import { describe, expectTypeOf, it } from 'vitest';
import { createModuleDefiner, createTypedClient } from './createTypedClient';

// 1. Hand-write the operations map — same shape codegen's `emitOperationEntry`
// would emit: { params, query, body, response }, mirroring the doc example.
interface MyOperations {
  getUser: { params: { id: string }; response: { id: string; name: string } };
  updateUser: {
    params: { id: string };
    body: { name?: string };
    response: { id: string; name: string };
  };
}

// 2. Hand-write module descriptors — same shape as generated `api.modules.ts`.
const descriptors = {
  users: {
    getUser: { method: 'GET', path: '/users/{id}', operationId: 'getUser' },
    updateUser: { method: 'PATCH', path: '/users/{id}', operationId: 'updateUser' },
  },
} as const;

describe('createTypedClient — hand-written Ops (no codegen)', () => {
  const api = createTypedClient<MyOperations>()(
    { baseURL: 'https://api.example.test', openapi: { mode: 'runtime' } },
    descriptors,
  );

  it('infers params + response for a hand-written operation', () => {
    expectTypeOf(api.users.getUser).parameter(0).toMatchTypeOf<{ id: string }>();
    expectTypeOf(api.users.getUser({ id: '1' })).resolves.toEqualTypeOf<{
      id: string;
      name: string;
    }>();
  });

  it('routes a hand-written body operation through the `body` key', () => {
    expectTypeOf(api.users.updateUser).parameter(0).toMatchTypeOf<{
      id: string;
      body: { name?: string };
    }>();
  });

  it('createModuleDefiner autocompletes method input from the hand-written Ops', () => {
    const defineModule = createModuleDefiner<MyOperations, typeof descriptors>();
    const getUser = (_ctx: unknown, input: { id: string }) =>
      Promise.resolve({ id: input.id, name: 'x' });
    const users = defineModule('users', { methods: { getUser } });
    expectTypeOf(users.methods.getUser).parameter(1).toEqualTypeOf<{ id: string }>();
  });
});
