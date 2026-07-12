/**
 * The transport abstraction. Adapters own the wire call only: they issue the
 * request and return a raw {@link AdapterResponse}. Classification of non-2xx
 * responses into typed errors happens later in the pipeline.
 */

import type { AdapterResponse, ApiRequest } from '../../types/http.types'

/**
 * A pluggable HTTP transport (fetch, axios, or a test double).
 *
 * Implementations MUST NOT throw on non-2xx status codes — those resolve as a
 * normal {@link AdapterResponse}. They should reject only on genuine transport
 * failures (network down, DNS, aborted request).
 */
export interface HttpAdapter {
  /** Issue the fully-resolved request and return the raw response envelope. */
  send(request: ApiRequest): Promise<AdapterResponse>
}

/** Zero-arg factory that constructs an {@link HttpAdapter}. */
export type AdapterFactory = () => HttpAdapter
