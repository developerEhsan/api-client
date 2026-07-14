/**
 * Test utilities for consumers of @developerEhsan/api-client.
 * Import via `@developerEhsan/api-client/testing`.
 */
export { createMockAdapter } from './mockAdapter';
export type { MockAdapter, MockResponse, RecordedCall } from './mockAdapter';
export { createMockClient } from './createMockClient';
export type { MockClientOptions, MockClientResult } from './createMockClient';
