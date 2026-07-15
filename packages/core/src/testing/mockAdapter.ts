import type { HttpAdapter } from '../http/adapters/adapterInterface';
/**
 * In-memory {@link HttpAdapter} for testing module methods without a network.
 * Register responses by method+path (or a matcher), assert on recorded calls.
 *
 *   const mock = createMockAdapter()
 *   mock.on('GET', '/invoices/{id}', { id: '1', amount: 10 })
 *   const api = createClient({ baseURL: 'http://x', openapi: { mode: 'runtime' },
 *     http: { adapter: mock } })
 */
import type { AdapterResponse, ApiRequest, HttpMethod } from '../types/http.types';

export interface MockResponse {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  data?: unknown;
}

export interface RecordedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  request: ApiRequest;
}

type Responder = MockResponse | ((request: ApiRequest) => MockResponse | Promise<MockResponse>);

export interface MockAdapter extends HttpAdapter {
  /** Register a responder for a method + URL substring (or path template). */
  on(method: HttpMethod, urlIncludes: string, response: Responder): MockAdapter;
  /** Fallback responder used when nothing matches (default: 404). */
  fallback(response: Responder): MockAdapter;
  /** All recorded calls, in order. */
  readonly calls: RecordedCall[];
  /** Calls matching a method + URL substring. */
  callsTo(method: HttpMethod, urlIncludes: string): RecordedCall[];
  reset(): void;
}

interface Rule {
  method: string;
  urlIncludes: string;
  responder: Responder;
}

function normalize(res: MockResponse): AdapterResponse {
  return {
    status: res.status ?? 200,
    statusText: res.statusText ?? (res.status && res.status >= 400 ? 'Error' : 'OK'),
    headers: res.headers ?? {},
    data: res.data ?? null,
  };
}

/**
 * Create an in-memory HTTP adapter for tests: register responses by method +
 * URL substring, then assert on the recorded calls.
 *
 * @example
 * ```ts
 * import { createMockAdapter } from '@developerehsan/api-client/testing'
 * import { createClient } from '@developerehsan/api-client'
 *
 * const mock = createMockAdapter()
 * mock.on('GET', '/pet/1', { id: 1, name: 'Rex' })
 *     .on('POST', '/pet', (req) => ({ status: 201, data: req.body }))
 *     .fallback({ status: 404, data: { message: 'not found' } })
 *
 * const api = createClient({
 *   baseURL: 'https://petstore3.swagger.io/api/v3',
 *   openapi: { mode: 'runtime' },
 *   http: { adapter: mock },
 * })
 * // ...drive api, then: mock.callsTo('GET', '/pet/1')
 * ```
 */
export function createMockAdapter(): MockAdapter {
  const rules: Rule[] = [];
  const calls: RecordedCall[] = [];
  let fallbackResponder: Responder = { status: 404, data: { message: 'No mock registered' } };

  const adapter: MockAdapter = {
    on(method, urlIncludes, response) {
      rules.push({ method, urlIncludes, responder: response });
      return adapter;
    },
    fallback(response) {
      fallbackResponder = response;
      return adapter;
    },
    get calls() {
      return calls;
    },
    callsTo(method, urlIncludes) {
      return calls.filter((c) => c.method === method && c.url.includes(urlIncludes));
    },
    reset() {
      rules.length = 0;
      calls.length = 0;
    },
    async send(request: ApiRequest): Promise<AdapterResponse> {
      const record: RecordedCall = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        request,
      };
      if (request.body !== undefined) record.body = request.body;
      calls.push(record);

      // Honor an already-aborted signal so cancellation tests behave.
      if (request.signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      const rule = rules.find(
        (r) => r.method === request.method && request.url.includes(r.urlIncludes),
      );
      const responder = rule?.responder ?? fallbackResponder;
      const res = typeof responder === 'function' ? await responder(request) : responder;
      return normalize(res);
    },
  };
  return adapter;
}
