/**
 * Browser client for the dedicated rate-limiting demo bridge.
 * Docs: https://github.com/developerEhsan/api-client/blob/master/docs/rpc-rate-limiting.md
 *
 * Same pattern as `./rpc-http-client.ts`, pointed at the demo's own
 * `/api/rpc-rate-limit-demo` route (3 calls / 10s) so it can be driven to a
 * 429 quickly without touching the main app's shared budget.
 */
import { createRpcClient, httpTransport } from '@developerehsan/api-client/browser';
import type { Api } from './api.config';

export const apiRateLimitDemo = createRpcClient<Api>(
  httpTransport({ endpoint: '/api/rpc-rate-limit-demo' }),
  { batch: false }, // one call = one round-trip, so the count-to-3 is exact
);
