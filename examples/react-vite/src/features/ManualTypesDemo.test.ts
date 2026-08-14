/**
 * TESTING DEMO — mock client, no real network
 * --------------------------------------------
 * Docs: https://github.com/developerEhsan/api-client/blob/master/docs/testing.md
 *
 * `createMockClient` builds a fully-wired client (same pipeline: queue,
 * dedup, cache, retry, validation) backed by an in-memory mock adapter, so
 * you can test module logic without touching the real DummyJSON API. This
 * mirrors the shape of `ManualTypesDemo.tsx` (a `quotes` module) but exercises
 * it entirely offline.
 *
 * Run: `pnpm --filter react-vite test`
 */
import { defineModule } from '@developerehsan/api-client';
import { createMockClient } from '@developerehsan/api-client/testing';
import { beforeEach, describe, expect, it } from 'vitest';

function buildTestApi() {
  return createMockClient({
    modules: {
      auto: false,
      quotes: defineModule({
        methods: {
          getQuote: async (ctx) =>
            (await ctx.request({ method: 'GET', path: '/quotes/random' })).data,
          getTodo: async (ctx, id: number) =>
            (await ctx.request({ method: 'GET', path: '/todos/{id}', pathParams: { id } })).data,
        },
      }),
    },
  });
}

// `createMockClient` (untyped) types every dynamic module as `unknown` by
// design, same as plain `createClient` — cast the one module surface used below.
type QuotesModule = {
  getQuote: () => Promise<unknown>;
  getTodo: (id: number) => Promise<unknown>;
};

describe('ManualTypesDemo module logic (mock client)', () => {
  let testApi: ReturnType<typeof buildTestApi>;
  let quotes: QuotesModule;

  beforeEach(() => {
    testApi = buildTestApi();
    quotes = testApi.api.quotes as QuotesModule;
  });

  it('resolves a mocked quote with no real network call', async () => {
    testApi.mock.on('GET', '/quotes/random', {
      data: { id: 1, quote: 'Test all the things.', author: 'A. Developer' },
    });

    const quote = (await quotes.getQuote()) as {
      id: number;
      quote: string;
      author: string;
    };

    expect(quote.quote).toBe('Test all the things.');
    expect(testApi.mock.callsTo('GET', '/quotes/random')).toHaveLength(1);
  });

  it('resolves a mocked todo by path param', async () => {
    testApi.mock.on('GET', '/todos/1', {
      data: { id: 1, todo: 'Write JSDoc examples', completed: true },
    });

    const todo = (await quotes.getTodo(1)) as {
      id: number;
      todo: string;
      completed: boolean;
    };

    expect(todo.completed).toBe(true);
    expect(testApi.mock.callsTo('GET', '/todos/1')).toHaveLength(1);
  });

  it('surfaces a 404 as a rejected promise, not a silent value', async () => {
    testApi.mock.on('GET', '/todos/999', () => ({ status: 404, data: { message: 'not found' } }));

    await expect(quotes.getTodo(999)).rejects.toBeDefined();
  });
});
