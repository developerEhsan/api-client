/**
 * The transport abstraction. Adapters own the wire call only: they issue the
 * request and return a raw {@link AdapterResponse}. Classification of non-2xx
 * responses into typed errors happens later in the pipeline.
 */

import type { AdapterResponse, ApiRequest } from '../../types/http.types';

/** A streaming response: status/headers plus the raw body byte stream. */
export interface AdapterStreamResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** The response body as a byte stream, or `null` for an empty body. */
  body: ReadableStream<Uint8Array> | null;
}

/**
 * A pluggable HTTP transport (fetch, axios, or a test double).
 *
 * Implementations MUST NOT throw on non-2xx status codes — those resolve as a
 * normal {@link AdapterResponse}. They should reject only on genuine transport
 * failures (network down, DNS, aborted request).
 */
export interface HttpAdapter {
  /** Issue the fully-resolved request and return the raw response envelope. */
  send(request: ApiRequest): Promise<AdapterResponse>;
  /**
   * Issue the request and return its body as a byte stream (roadmap E1).
   * Optional: only stream-capable adapters (fetch) implement it; the pipeline
   * raises a `ConfigurationError` when streaming is requested on an adapter
   * without it (e.g. axios in the browser).
   */
  stream?(request: ApiRequest): Promise<AdapterStreamResponse>;
}

/** Zero-arg factory that constructs an {@link HttpAdapter}. */
export type AdapterFactory = () => HttpAdapter;
