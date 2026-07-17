/**
 * ctx.stream integration (E1): a stream-capable adapter feeds NDJSON/SSE through
 * the client (auth/tenant/URL resolved), bypassing cache/dedup/validation.
 */
import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../errors/ConfigurationError';
import type { HttpAdapter } from '../http/adapters/adapterInterface';
import { createClient } from './createClient';
import type { ModuleContext, SseEvent } from '../index';

const enc = new TextEncoder();
function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of chunks) c.enqueue(enc.encode(s));
      c.close();
    },
  });
}

/** A stream-capable adapter that records the request and replays fixed chunks. */
function streamAdapter(chunks: string[], status = 200): { adapter: HttpAdapter; seen: () => string } {
  let url = '';
  const adapter: HttpAdapter = {
    send: () => Promise.reject(new Error('send not used')),
    stream: (request) => {
      url = request.url;
      return Promise.resolve({
        status,
        statusText: 'OK',
        headers: {},
        body: status >= 400 ? null : streamOf(...chunks),
      });
    },
  };
  return { adapter, seen: () => url };
}

function clientWith(adapter: HttpAdapter) {
  let ctx: ModuleContext | undefined;
  const api = createClient({
    baseURL: 'http://stream.test',
    openapi: { mode: 'runtime' },
    http: { adapter },
    tenancy: { getTenantId: () => 't1' },
    modules: {
      auto: false as const,
      feed: {
        methods: {
          grab: async (c: ModuleContext) => {
            ctx = c;
            return c;
          },
        },
      },
    },
  });
  return { api: api as unknown as { feed: { grab: () => Promise<ModuleContext> } } };
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('ctx.stream', () => {
  it('streams NDJSON values and resolves the URL', async () => {
    const { adapter, seen } = streamAdapter(['{"n":1}\n{"n":2}\n', '{"n":3}']);
    const { api } = clientWith(adapter);
    const ctx = await api.feed.grab();
    const items = await collect(
      ctx.stream<{ n: number }>({ method: 'GET', path: '/events' }, { mode: 'ndjson' }),
    );
    expect(items).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(seen()).toBe('http://stream.test/events');
  });

  it('streams SSE events', async () => {
    const { adapter } = streamAdapter(['data: a\n\n', 'data: b\n\n']);
    const { api } = clientWith(adapter);
    const ctx = await api.feed.grab();
    const events = await collect(ctx.stream<SseEvent>({ method: 'GET', path: '/sse' }, { mode: 'sse' }));
    expect(events).toEqual([{ data: 'a' }, { data: 'b' }]);
  });

  it('throws an ApiError on a non-2xx stream response', async () => {
    const { adapter } = streamAdapter([], 500);
    const { api } = clientWith(adapter);
    const ctx = await api.feed.grab();
    await expect(collect(ctx.stream({ method: 'GET', path: '/bad' }))).rejects.toMatchObject({
      status: 500,
    });
  });

  it('requires a stream-capable adapter', async () => {
    // An adapter WITHOUT a `stream` method.
    const sendOnly: HttpAdapter = { send: () => Promise.reject(new Error('x')) };
    const { api } = clientWith(sendOnly);
    const ctx = await api.feed.grab();
    await expect(collect(ctx.stream({ method: 'GET', path: '/x' }))).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });
});
