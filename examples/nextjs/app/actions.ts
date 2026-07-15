'use server';

import { rpcHandler } from '@/lib/api/api.config';
/**
 * Server Actions for the SSR RPC bridge. Everything in a `"use server"` module
 * runs only on the server, so the real client — and the base URL, backend
 * paths, and OpenAPI document it holds — never ships to the browser. The client
 * calls `rpc({ module, method, args })`; the handler validates and dispatches.
 */
import { createNextRpcAction } from '@developerehsan/api-client/server';

export const rpc = createNextRpcAction(rpcHandler);
