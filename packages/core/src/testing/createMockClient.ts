import { type ApiClient, createClient } from '../factory/createClient';
/**
 * Test helper: build a fully-wired client backed by a {@link MockAdapter}, with
 * sensible test defaults (no retries/backoff delay, dedup/queue off unless you
 * want them). Returns both the client and the mock so tests can register
 * responses and assert on calls.
 *
 *   const { api, mock } = createMockClient({
 *     modules: { auto: false, invoices: { methods: { get: ... } } },
 *   })
 *   mock.on('GET', '/invoices/1', { id: '1' })
 */
import type { GlobalConfig } from '../types/config.types';
import { type MockAdapter, createMockAdapter } from './mockAdapter';

export interface MockClientOptions extends Partial<Omit<GlobalConfig, 'openapi'>> {
  openapi?: GlobalConfig['openapi'];
}

export interface MockClientResult {
  api: ApiClient;
  mock: MockAdapter;
}

/**
 * Build a fully-wired client backed by a {@link MockAdapter} for tests.
 *
 * @example
 * ```ts
 * import { createMockClient } from '@developerehsan/api-client/testing'
 * import { defineModule } from '@developerehsan/api-client'
 *
 * const { api, mock } = createMockClient({
 *   modules: {
 *     pet: defineModule({
 *       methods: {
 *         getPetById: (ctx, petId: number) =>
 *           ctx.request({ method: 'GET', path: '/pet/{petId}', pathParams: { petId } }),
 *       },
 *     }),
 *   },
 * })
 *
 * mock.on('GET', '/pet/1', { id: 1, name: 'Rex' })
 * const res = await api.pet.getPetById(1)
 * expect(mock.callsTo('GET', '/pet/1')).toHaveLength(1)
 * ```
 */
export function createMockClient(options: MockClientOptions = {}): MockClientResult {
  const mock = createMockAdapter();

  const { http, ...rest } = options;
  const config: GlobalConfig = {
    ...rest,
    baseURL: options.baseURL ?? 'http://mock.test',
    openapi: options.openapi ?? { mode: 'runtime' },
    http: {
      // Deterministic defaults for tests: instant retries, no queueing surprises.
      retry: { attempts: 1, baseDelay: 0, maxDelay: 0, jitter: false },
      ...http,
      adapter: mock,
    },
  };

  return { api: createClient(config), mock };
}
