/**
 * Browser-side batching (E2): calls made in the same microtask are coalesced
 * into one batched round-trip when the transport supports `batch`.
 */
import { describe, expect, it } from 'vitest';
import type { RpcCall, RpcResponse } from '../rpc/protocol';
import { createRpcClient } from './createRpcClient';
import type { Transport } from './types';

interface Api {
  pet: {
    getPetById: (input: { petId: number }) => Promise<{ id: number }>;
  };
}

/** A transport recording how calls arrive (single vs batched). */
function recordingTransport() {
  const singleCalls: RpcCall[] = [];
  const batches: RpcCall[][] = [];
  const transport: Transport = async (call): Promise<RpcResponse> => {
    singleCalls.push(call);
    return { ok: true, data: { id: (call.args[0] as { petId: number }).petId } };
  };
  transport.batch = async (calls): Promise<RpcResponse[]> => {
    batches.push(calls);
    return calls.map((c) => ({ ok: true, data: { id: (c.args[0] as { petId: number }).petId } }));
  };
  return { transport, singleCalls, batches };
}

describe('createRpcClient batching', () => {
  it('coalesces same-tick calls into one batch', async () => {
    const { transport, batches } = recordingTransport();
    const api = createRpcClient<Api>(transport, { batch: true });
    const [a, b, c] = await Promise.all([
      api.pet.getPetById({ petId: 1 }),
      api.pet.getPetById({ petId: 2 }),
      api.pet.getPetById({ petId: 3 }),
    ]);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
    expect([a, b, c]).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('sends a lone call individually (skips the batch envelope)', async () => {
    const { transport, singleCalls, batches } = recordingTransport();
    const api = createRpcClient<Api>(transport, { batch: true });
    const r = await api.pet.getPetById({ petId: 7 });
    expect(r).toEqual({ id: 7 });
    expect(batches).toHaveLength(0);
    expect(singleCalls).toHaveLength(1);
  });

  it('respects maxBatchSize by splitting into chunks', async () => {
    const { transport, batches } = recordingTransport();
    const api = createRpcClient<Api>(transport, { batch: true, maxBatchSize: 2 });
    await Promise.all([
      api.pet.getPetById({ petId: 1 }),
      api.pet.getPetById({ petId: 2 }),
      api.pet.getPetById({ petId: 3 }),
    ]);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(2);
    expect(batches[1]).toHaveLength(1);
  });

  it('does not batch when the option is off', async () => {
    const { transport, singleCalls, batches } = recordingTransport();
    const api = createRpcClient<Api>(transport);
    await Promise.all([api.pet.getPetById({ petId: 1 }), api.pet.getPetById({ petId: 2 })]);
    expect(batches).toHaveLength(0);
    expect(singleCalls).toHaveLength(2);
  });

  it('rejects all entries when the batch response length mismatches (whole-batch failure)', async () => {
    const transport: Transport = async () => ({ ok: true, data: null });
    // A broken batch that returns too few responses.
    transport.batch = async () => [{ ok: true, data: { id: 1 } }];
    const api = createRpcClient<Api>(transport, { batch: true });
    const results = await Promise.allSettled([
      api.pet.getPetById({ petId: 1 }),
      api.pet.getPetById({ petId: 2 }),
    ]);
    expect(results[0]!.status).toBe('fulfilled');
    expect(results[1]!.status).toBe('rejected');
  });
});
