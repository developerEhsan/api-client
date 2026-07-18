/**
 * Framework RPC adapter tests (E5): TanStack Start + Remix wrappers reuse the
 * framework-agnostic route handler (same CSRF/allowlist guards).
 */
import { describe, expect, it } from 'vitest';
import { createRpcHandler } from './createRpcHandler';
import { createRemixRpcAction, createStartRpcRoute } from './frameworks';

const api = { pet: { getPetById: () => Promise.resolve({ id: 1 }) } };
const handler = createRpcHandler(api, { expose: { pet: ['getPetById'] } });

function req(body: unknown): Request {
  return new Request('https://app.example.com/api/rpc', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'app.example.com',
      origin: 'https://app.example.com',
    },
    body: JSON.stringify(body),
  });
}

describe('createStartRpcRoute', () => {
  it('handles a same-origin call from a { request } context', async () => {
    const route = createStartRpcRoute(handler);
    const res = await route({
      request: req({ module: 'pet', method: 'getPetById', args: [{ pathParams: { petId: 1 } }] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { id: 1 } });
  });
});

describe('createRemixRpcAction', () => {
  it('handles a Remix action { request } and enforces CSRF', async () => {
    const action = createRemixRpcAction(handler);
    const ok = await action({ request: req({ module: 'pet', method: 'getPetById', args: [] }) });
    expect(ok.status).toBe(200);

    // Cross-origin is rejected by the underlying route guard (S7).
    const crossOrigin = new Request('https://app.example.com/api/rpc', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'app.example.com',
        origin: 'https://evil.example.net',
      },
      body: JSON.stringify({ module: 'pet', method: 'getPetById', args: [] }),
    });
    const denied = await action({ request: crossOrigin });
    expect(denied.status).toBe(403);
  });
});
