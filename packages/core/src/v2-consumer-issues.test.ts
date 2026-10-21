/**
 * Regression cover for the v2 consumer-reported issues (#37–#46). One test per
 * behavior that a consumer actually got bitten by.
 */
import { describe, expect, it, vi } from 'vitest';
import { createIndexedDbStore } from './cache-stores';
import { classifyError, extractServerError } from './errors/errorClassifier';
import { createClient } from './factory/createClient';
import { createRpcHandler } from './server/createRpcHandler';
import { createRpcRouteHandler } from './server/routeHandler';
import { createMockClient } from './testing/createMockClient';
import type { ModuleContext } from './types/module.types';
import { collectPages, paginate, paginateItems } from './utilities/paginate';

// --- #45: openapi optional ------------------------------------------------
describe('#45 openapi is optional', () => {
  it('constructs without an openapi block', () => {
    expect(() => createClient({ baseURL: 'https://example.test' })).not.toThrow();
  });

  it('still rejects a non-object openapi', () => {
    expect(() =>
      createClient({ baseURL: 'https://example.test', openapi: 'nope' as never }),
    ).toThrow(/openapi/);
  });
});

// --- #39: custom error envelope ------------------------------------------
describe('#39 errorEnvelope', () => {
  const nested = { error: { code: 'flag_not_found', message: 'Flag not found' } };

  it('without a parser, a nested envelope is not recognized', () => {
    expect(extractServerError(nested).serverError).toBeNull();
  });

  it('a parser flattens the envelope into the error message', () => {
    const err = classifyError(
      { kind: 'http', status: 404, statusText: 'Not Found', headers: {}, data: nested },
      (body) => (body as typeof nested).error,
    );
    expect(err.message).toBe('Flag not found');
    expect(err.code).toBe('flag_not_found');
  });

  it('a throwing parser falls back instead of masking the failure', () => {
    const err = classifyError(
      { kind: 'http', status: 500, statusText: 'Server Error', headers: {}, data: nested },
      () => {
        throw new Error('bad parser');
      },
    );
    expect(err.status).toBe(500);
  });

  it('is applied to errors raised by the pipeline', async () => {
    const { api, mock } = createMockClient({
      errorEnvelope: (body) =>
        (body as { error?: { code: string; message: string } }).error ?? null,
      modules: {
        auto: false as const,
        flags: {
          methods: {
            get: async (ctx: ModuleContext) =>
              (await ctx.request({ method: 'GET', path: '/flags/1' })).data,
          },
        },
      },
    });
    mock.on('GET', '/flags/1', { status: 404, data: nested });
    const typed = api as unknown as { flags: { get: () => Promise<unknown> } };
    await expect(typed.flags.get()).rejects.toThrow('Flag not found');
  });
});

// --- #40: cache off by default -------------------------------------------
describe('#40 cache is off by default', () => {
  const build = (cache?: Record<string, unknown>) => {
    const { api, mock } = createMockClient({
      ...(cache ? { cache } : {}),
      modules: {
        auto: false as const,
        things: {
          methods: {
            get: async (ctx: ModuleContext) =>
              (await ctx.request({ method: 'GET', path: '/things/1' })).data,
          },
        },
      },
    });
    return { api: api as unknown as { things: { get: () => Promise<unknown> } }, mock };
  };

  it('a repeated GET hits the network twice', async () => {
    let hits = 0;
    const { api, mock } = build();
    mock.on('GET', '/things/1', () => {
      hits++;
      return { data: { id: 1 } };
    });
    await api.things.get();
    await api.things.get();
    expect(hits).toBe(2);
  });

  it('opting in restores caching', async () => {
    let hits = 0;
    const { api, mock } = build({ enabled: true });
    mock.on('GET', '/things/1', () => {
      hits++;
      return { data: { id: 1 } };
    });
    await api.things.get();
    await api.things.get();
    expect(hits).toBe(1);
  });
});

// --- #42: retry safety + idempotency key ---------------------------------
describe('#42 unsafe methods are not retried by default', () => {
  const build = (config: Record<string, unknown> = {}) => {
    const { api, mock } = createMockClient({
      ...config,
      modules: {
        auto: false as const,
        things: {
          methods: {
            create: async (ctx: ModuleContext) =>
              (await ctx.request({ method: 'POST', path: '/things', body: { a: 1 } })).data,
            replace: async (ctx: ModuleContext) =>
              (await ctx.request({ method: 'PUT', path: '/things/1', body: { a: 1 } })).data,
          },
        },
      },
    });
    return {
      api: api as unknown as {
        things: { create: () => Promise<unknown>; replace: () => Promise<unknown> };
      },
      mock,
    };
  };

  it('a 500 on POST is attempted exactly once', async () => {
    let attempts = 0;
    const { api, mock } = build();
    mock.on('POST', '/things', () => {
      attempts++;
      return { status: 500, data: { message: 'boom' } };
    });
    await expect(api.things.create()).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it('a 500 on PUT still retries (PUT is idempotent)', async () => {
    let attempts = 0;
    const { api, mock } = build({ http: { retry: { attempts: 3, baseDelay: 0 } } });
    mock.on('PUT', '/things/1', () => {
      attempts++;
      return { status: 500, data: { message: 'boom' } };
    });
    await expect(api.things.replace()).rejects.toThrow();
    expect(attempts).toBe(3);
  });

  it('retryUnsafeMethods opts POST back in', async () => {
    let attempts = 0;
    const { api, mock } = build({
      http: { retry: { attempts: 3, baseDelay: 0, retryUnsafeMethods: true } },
    });
    mock.on('POST', '/things', () => {
      attempts++;
      return { status: 500, data: { message: 'boom' } };
    });
    await expect(api.things.create()).rejects.toThrow();
    expect(attempts).toBe(3);
  });

  it('reuses ONE idempotency key across every retry of a call', async () => {
    const keys: Array<string | undefined> = [];
    const { api, mock } = build({
      http: {
        retry: { attempts: 3, baseDelay: 0, retryUnsafeMethods: true },
        idempotency: { enabled: true },
      },
    });
    mock.on('POST', '/things', (req: { headers: Record<string, string> }) => {
      keys.push(req.headers['Idempotency-Key'] ?? req.headers['idempotency-key']);
      return { status: 500, data: { message: 'boom' } };
    });
    await expect(api.things.create()).rejects.toThrow();
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBeTruthy();
  });

  it('sends no key when idempotency is off', async () => {
    const seen: Array<string | undefined> = [];
    const { api, mock } = build();
    mock.on('POST', '/things', (req: { headers: Record<string, string> }) => {
      seen.push(req.headers['Idempotency-Key']);
      return { data: { ok: true } };
    });
    await api.things.create();
    expect(seen[0]).toBeUndefined();
  });
});

// --- #43: pagination ------------------------------------------------------
describe('#43 pagination helpers', () => {
  interface Page {
    data: number[];
    nextCursor: string | null;
  }
  const pages: Record<string, Page> = {
    __first: { data: [1, 2], nextCursor: 'b' },
    b: { data: [3], nextCursor: null },
  };
  const fetchPage = (cursor?: string | number): Promise<Page> =>
    Promise.resolve(pages[cursor === undefined ? '__first' : String(cursor)] as Page);

  it('walks every page until the cursor runs out', async () => {
    const seen: Page[] = [];
    for await (const page of paginate(fetchPage, { nextCursor: (p) => p.nextCursor })) {
      seen.push(page);
    }
    expect(seen).toHaveLength(2);
  });

  it('flattens items across pages', async () => {
    const items: number[] = [];
    for await (const item of paginateItems(fetchPage, {
      nextCursor: (p) => p.nextCursor,
      items: (p) => p.data,
    })) {
      items.push(item);
    }
    expect(items).toEqual([1, 2, 3]);
  });

  it('collectPages drains into one array', async () => {
    await expect(
      collectPages(fetchPage, { nextCursor: (p) => p.nextCursor, items: (p) => p.data }),
    ).resolves.toEqual([1, 2, 3]);
  });

  it('stops instead of spinning when the server echoes the same cursor', async () => {
    let calls = 0;
    const stuck = (): Promise<Page> => {
      calls++;
      return Promise.resolve({ data: [0], nextCursor: 'same' });
    };
    const seen: Page[] = [];
    for await (const page of paginate(stuck, { nextCursor: (p) => p.nextCursor })) {
      seen.push(page);
    }
    // First page, then one more for cursor 'same', then the repeat is detected.
    expect(calls).toBe(2);
  });

  it('honors maxPages', async () => {
    let n = 0;
    const endless = (): Promise<Page> => Promise.resolve({ data: [n], nextCursor: String(n++) });
    const seen: Page[] = [];
    for await (const page of paginate(endless, {
      nextCursor: (p) => p.nextCursor,
      maxPages: 3,
    })) {
      seen.push(page);
    }
    expect(seen).toHaveLength(3);
  });
});

// --- #46: IndexedDB cross-tab invalidation --------------------------------
describe('#46 IndexedDB crossTab invalidation', () => {
  it('does not expose the hooks unless crossTab is on', () => {
    const store = createIndexedDbStore();
    expect(store.publishInvalidate).toBeUndefined();
    expect(store.onRemoteInvalidate).toBeUndefined();
  });

  it('broadcasts to a sibling tab and never echoes to itself', async () => {
    const channels: Array<{ name: string; onmessage: ((e: { data: unknown }) => void) | null }> =
      [];
    class FakeBC {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      constructor(public name: string) {
        channels.push(this);
      }
      postMessage(data: unknown) {
        for (const c of channels) if (c !== this) c.onmessage?.({ data });
      }
    }
    vi.stubGlobal('BroadcastChannel', FakeBC);

    const tabA = createIndexedDbStore({ crossTab: true });
    const tabB = createIndexedDbStore({ crossTab: true });
    const onA: unknown[] = [];
    const onB: unknown[] = [];
    tabA.onRemoteInvalidate?.((m) => onA.push(m));
    tabB.onRemoteInvalidate?.((m) => onB.push(m));

    await tabA.publishInvalidate?.({ type: 'tags', values: ['flag:1'] });

    expect(onB).toHaveLength(1);
    expect(onA).toHaveLength(0); // own-origin message is ignored
    vi.unstubAllGlobals();
  });

  it('degrades to a plain store where BroadcastChannel is absent', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const store = createIndexedDbStore({ crossTab: true });
    expect(store.publishInvalidate).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

// --- #37 / #38: RPC binary + multipart ------------------------------------
describe('#37/#38 RPC binary responses and multipart uploads', () => {
  const makeApi = () => ({
    exports: {
      flagsCsv: () => Promise.resolve(new Blob(['a,b\n1,2'], { type: 'text/csv' })),
      asJson: () => Promise.resolve({ rows: 2 }),
    },
    files: {
      upload: (input: unknown) => Promise.resolve({ got: input }),
    },
  });

  const post = (body: BodyInit, contentType?: string): Request =>
    new Request('https://app.test/api/rpc', {
      method: 'POST',
      headers: {
        origin: 'https://app.test',
        host: 'app.test',
        ...(contentType ? { 'content-type': contentType } : {}),
      },
      body,
    });

  it('streams a declared-binary method back with its own content type', async () => {
    const route = createRpcRouteHandler(
      createRpcHandler(makeApi(), {
        expose: { exports: ['flagsCsv'] },
        binary: { exports: ['flagsCsv'] },
        binaryFilename: () => 'flags.csv',
      }),
    );
    const res = await route(
      post(JSON.stringify({ module: 'exports', method: 'flagsCsv', args: [] }), 'application/json'),
    );
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="flags.csv"');
    expect(await res.text()).toBe('a,b\n1,2');
  });

  it('a method not declared binary still returns the JSON envelope', async () => {
    const route = createRpcRouteHandler(
      createRpcHandler(makeApi(), { expose: { exports: ['asJson'] } }),
    );
    const res = await route(
      post(JSON.stringify({ module: 'exports', method: 'asJson', args: [] }), 'application/json'),
    );
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ ok: true, data: { rows: 2 } });
  });

  it('binary is server-declared: a client-supplied responseType cannot force it', async () => {
    const route = createRpcRouteHandler(
      createRpcHandler(makeApi(), { expose: { exports: ['asJson'] } }),
    );
    const res = await route(
      post(
        JSON.stringify({
          module: 'exports',
          method: 'asJson',
          args: [{}, { responseType: 'blob' }],
        }),
        'application/json',
      ),
    );
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('rejects multipart unless the route opted in', async () => {
    const form = new FormData();
    form.append('__rpc', JSON.stringify({ module: 'files', method: 'upload', args: [{}] }));
    const route = createRpcRouteHandler(
      createRpcHandler(makeApi(), { expose: { files: ['upload'] } }),
    );
    const res = await route(post(form));
    expect(res.status).toBe(415);
  });

  it('revives a File argument from a multipart body', async () => {
    // Asserted server-side: the response is JSON, so a File would flatten to
    // {} on the way back no matter what the handler received.
    let received: unknown;
    const api = {
      files: {
        upload: (input: unknown) => {
          received = input;
          return Promise.resolve({ ok: true });
        },
      },
    };
    const form = new FormData();
    form.append(
      '__rpc',
      JSON.stringify({
        module: 'files',
        method: 'upload',
        args: [{ body: { avatar: { __rpcFile: '__file0' } } }],
      }),
    );
    form.append('__file0', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');

    const route = createRpcRouteHandler(createRpcHandler(api, { expose: { files: ['upload'] } }), {
      multipart: true,
    });
    const res = await route(post(form));
    expect((await res.json()).ok).toBe(true);

    const avatar = (received as { body: { avatar: unknown } }).body.avatar;
    expect(avatar).toBeInstanceOf(Blob);
    expect(await (avatar as Blob).text()).toBe('hello');
  });

  it('rejects a body that exceeds maxUploadBytes even with no Content-Length', async () => {
    const form = new FormData();
    form.append('__rpc', JSON.stringify({ module: 'files', method: 'upload', args: [{}] }));
    form.append('__file0', new Blob(['x'.repeat(5000)]), 'big.bin');

    const route = createRpcRouteHandler(
      createRpcHandler(makeApi(), { expose: { files: ['upload'] } }),
      { multipart: true, maxUploadBytes: 1024 },
    );
    // Streaming the body strips Content-Length, so only the byte-level cap
    // can catch this.
    const built = new Request('https://app.test/api/rpc', { method: 'POST', body: form });
    const res = await route(
      new Request('https://app.test/api/rpc', {
        method: 'POST',
        headers: {
          origin: 'https://app.test',
          host: 'app.test',
          'content-type': built.headers.get('content-type') as string,
        },
        body: built.body,
        duplex: 'half',
      } as RequestInit),
    );
    expect(res.status).toBe(413);
  });

  it('a __proto__ key in a multipart envelope stays visible to the input guard', async () => {
    let received: unknown = 'NOT CALLED';
    const api = {
      files: {
        upload: (input: unknown) => {
          received = input;
          return Promise.resolve({ ok: true });
        },
      },
    };
    const form = new FormData();
    // Written as a raw string on purpose: `{ __proto__: ... }` in a JS object
    // literal sets the prototype, so JSON.stringify would emit `{}` and the
    // test would prove nothing.
    form.append(
      '__rpc',
      '{"module":"files","method":"upload","args":[{"__proto__":{"polluted":true}}]}',
    );
    form.append('__file0', new Blob(['x']), 'a.txt');

    const route = createRpcRouteHandler(createRpcHandler(api, { expose: { files: ['upload'] } }), {
      multipart: true,
    });
    const res = await route(post(form));

    // The handler's FORBIDDEN_KEYS guard must still reject it: a plain
    // `out[k] = v` during revival would have moved the key onto the prototype,
    // hiding it from Object.keys and silently letting the call through.
    expect((await res.json()).ok).toBe(false);
    expect(received).toBe('NOT CALLED');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('a binary method inside a batch is refused rather than JSON-mangled', async () => {
    const h = createRpcHandler(makeApi(), {
      expose: { exports: ['flagsCsv'] },
      binary: { exports: ['flagsCsv'] },
    });
    const [res] = await h.handleBatch({
      __rpcBatch: [{ module: 'exports', method: 'flagsCsv', args: [] }],
    });
    expect(res?.ok).toBe(false);
  });
});
