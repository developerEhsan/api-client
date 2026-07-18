/**
 * RPC batching tests (E2). Each `S#` maps to a batching threat: batching must
 * never be an allowlist bypass (S13), an amplification vector (S14), an
 * authorize bypass (S15), or a nesting/recursion vector (S16).
 */
import { describe, expect, it, vi } from 'vitest';
import { createRpcHandler } from './createRpcHandler';

function makeApi() {
  const calls: string[] = [];
  const api = {
    pet: {
      getPetById(input: unknown) {
        calls.push('getPetById');
        return Promise.resolve({ id: (input as { petId?: number })?.petId ?? 0 });
      },
      deletePet() {
        calls.push('deletePet');
        return Promise.resolve({ deleted: true });
      },
    },
  };
  return { api, calls };
}

describe('handleBatch', () => {
  it('dispatches all sub-calls and preserves order', async () => {
    const { api } = makeApi();
    const h = createRpcHandler(api, { expose: { pet: ['getPetById'] } });
    const res = await h.handleBatch({
      __rpcBatch: [
        { module: 'pet', method: 'getPetById', args: [{ petId: 1 }] },
        { module: 'pet', method: 'getPetById', args: [{ petId: 2 }] },
      ],
    });
    expect(res).toHaveLength(2);
    expect(res[0]).toEqual({ ok: true, data: { id: 1 } });
    expect(res[1]).toEqual({ ok: true, data: { id: 2 } });
  });

  it('S13: a denied sub-call is rejected individually, allowed siblings proceed', async () => {
    const { api, calls } = makeApi();
    const h = createRpcHandler(api, { expose: { pet: ['getPetById'] } });
    const res = await h.handleBatch({
      __rpcBatch: [
        { module: 'pet', method: 'getPetById', args: [{ petId: 1 }] },
        { module: 'pet', method: 'deletePet', args: [] }, // not exposed
      ],
    });
    expect(res[0]!.ok).toBe(true);
    expect(res[1]!.ok).toBe(false);
    // The denied method must never have been dispatched.
    expect(calls).toEqual(['getPetById']);
  });

  it('S14: a batch over maxBatchSize is rejected WHOLE, before any dispatch', async () => {
    const { api, calls } = makeApi();
    const h = createRpcHandler(api, { expose: { pet: ['getPetById'] }, maxBatchSize: 2 });
    const res = await h.handleBatch({
      __rpcBatch: [
        { module: 'pet', method: 'getPetById', args: [{ petId: 1 }] },
        { module: 'pet', method: 'getPetById', args: [{ petId: 2 }] },
        { module: 'pet', method: 'getPetById', args: [{ petId: 3 }] },
      ],
    });
    expect(res).toHaveLength(1);
    expect(res[0]!.ok).toBe(false);
    expect(calls).toEqual([]); // nothing dispatched
  });

  it('S15: authorize runs once PER sub-call (not once per envelope)', async () => {
    const { api } = makeApi();
    const authorize = vi.fn().mockResolvedValue(true);
    const h = createRpcHandler(api, { expose: { pet: ['getPetById'] }, authorize });
    await h.handleBatch({
      __rpcBatch: [
        { module: 'pet', method: 'getPetById', args: [{ petId: 1 }] },
        { module: 'pet', method: 'getPetById', args: [{ petId: 2 }] },
      ],
    });
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it('S15: a per-call authorize denial isolates to that entry', async () => {
    const { api } = makeApi();
    const h = createRpcHandler(api, {
      expose: { pet: ['getPetById'] },
      authorize: (_ctx, call) => (call.args[0] as { petId?: number })?.petId !== 2,
    });
    const res = await h.handleBatch({
      __rpcBatch: [
        { module: 'pet', method: 'getPetById', args: [{ petId: 1 }] },
        { module: 'pet', method: 'getPetById', args: [{ petId: 2 }] }, // denied
      ],
    });
    expect(res[0]!.ok).toBe(true);
    expect(res[1]!.ok).toBe(false);
  });

  it('S16: a nested batch envelope is rejected whole', async () => {
    const { api, calls } = makeApi();
    const h = createRpcHandler(api, { expose: { pet: ['getPetById'] } });
    const res = await h.handleBatch({
      __rpcBatch: [
        { module: 'pet', method: 'getPetById', args: [{ petId: 1 }] },
        { __rpcBatch: [{ module: 'pet', method: 'getPetById', args: [] }] } as never,
      ],
    });
    expect(res).toHaveLength(1);
    expect(res[0]!.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('rejects a non-batch payload', async () => {
    const { api } = makeApi();
    const h = createRpcHandler(api, { expose: { pet: ['getPetById'] } });
    const res = await h.handleBatch({ not: 'a batch' });
    expect(res).toHaveLength(1);
    expect(res[0]!.ok).toBe(false);
  });
});
