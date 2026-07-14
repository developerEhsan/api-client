/**
 * Browser RPC client tests: serialization, error rehydration, and the
 * non-thenable proxy guard.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors/ApiError';
import type { RpcCall, RpcResponse } from '../rpc/protocol';
import { createRpcClient } from './createRpcClient';
import { httpTransport, serverActionTransport } from './transports';

interface FakeApi {
  pet: { getPetById(input: { pathParams: { petId: number } }): Promise<{ id: number }> };
}

describe('createRpcClient', () => {
  it('serializes module/method/args to the transport and returns data', async () => {
    const seen: RpcCall[] = [];
    const transport = async (call: RpcCall): Promise<RpcResponse> => {
      seen.push(call);
      return { ok: true, data: { id: 7 } };
    };
    const api = createRpcClient<FakeApi>(transport);
    const result = await api.pet.getPetById({ pathParams: { petId: 7 } });
    expect(result).toEqual({ id: 7 });
    expect(seen[0]).toEqual({
      module: 'pet',
      method: 'getPetById',
      args: [{ pathParams: { petId: 7 } }],
    });
  });

  it('rehydrates an RpcError into a real ApiError (instanceof holds)', async () => {
    const transport = async (): Promise<RpcResponse> => ({
      ok: false,
      error: {
        __rpcError: true,
        name: 'AuthError',
        status: 401,
        code: 'unauthorized',
        message: 'nope',
      },
    });
    const api = createRpcClient<FakeApi>(transport);
    await expect(api.pet.getPetById({ pathParams: { petId: 1 } })).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ApiError &&
        (e as ApiError).status === 401 &&
        (e as Error).name === 'AuthError',
    );
  });

  it('strips a per-call AbortSignal from the wire payload (serialization-safe)', async () => {
    const seen: RpcCall[] = [];
    const transport = async (call: RpcCall): Promise<RpcResponse> => {
      seen.push(call);
      return { ok: true, data: null };
    };
    const api = createRpcClient<FakeApi>(transport);
    const ac = new AbortController();
    await (api.pet.getPetById as (i: unknown, p: unknown) => Promise<unknown>)(
      { pathParams: { petId: 1 } },
      { signal: ac.signal, timeout: 5000 },
    );
    // signal removed; timeout preserved — nothing non-serializable crosses.
    expect(seen[0]!.args).toEqual([{ pathParams: { petId: 1 } }, { timeout: 5000 }]);
  });

  it('rejects with an AbortError when the signal aborts', async () => {
    const transport = (): Promise<RpcResponse> => new Promise(() => {}); // never resolves
    const api = createRpcClient<FakeApi>(transport);
    const ac = new AbortController();
    const p = (api.pet.getPetById as (i: unknown, p: unknown) => Promise<unknown>)(
      { pathParams: { petId: 1 } },
      { signal: ac.signal },
    );
    ac.abort();
    await expect(p).rejects.toSatisfy((e: unknown) => (e as Error).name === 'AbortError');
  });

  it('module namespace is not a thenable (no accidental await hang)', () => {
    const api = createRpcClient<FakeApi>(async () => ({ ok: true, data: null }));
    // Accessing `then` on a module must be undefined, not a function.
    expect((api.pet as unknown as { then?: unknown }).then).toBeUndefined();
  });
});

describe('transports', () => {
  it('serverActionTransport forwards the call verbatim', async () => {
    let received: RpcCall | undefined;
    const action = async (call: RpcCall): Promise<RpcResponse> => {
      received = call;
      return { ok: true, data: 1 };
    };
    const t = serverActionTransport(action);
    await t({ module: 'a', method: 'b', args: [] });
    expect(received).toEqual({ module: 'a', method: 'b', args: [] });
  });

  it('httpTransport POSTs JSON and parses the envelope', async () => {
    const fakeFetch: typeof fetch = async (_url, init) => {
      expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json');
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ ok: true, data: { hi: true } }), {
        headers: { 'content-type': 'application/json' },
      });
    };
    const t = httpTransport({ endpoint: '/api/rpc', fetch: fakeFetch });
    const res = await t({ module: 'a', method: 'b', args: [] });
    expect(res).toEqual({ ok: true, data: { hi: true } });
  });

  it('httpTransport returns a generic error envelope on a non-envelope response', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain' } });
    const t = httpTransport({ endpoint: '/api/rpc', fetch: fakeFetch });
    const res = await t({ module: 'a', method: 'b', args: [] });
    expect(res.ok).toBe(false);
  });
});
