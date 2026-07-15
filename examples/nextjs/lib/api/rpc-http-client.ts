/**
 * SSR RPC bridge — browser side, GENERIC HTTP transport variant.
 *
 * Identical surface to `./rpc-client` (`apiHttp.pet.getPetById(...)`), but each
 * call is a `POST /api/rpc` instead of a Server Action. This is the
 * framework-agnostic path — the same client works in TanStack Start, Remix, or
 * any server that mounts `createRpcRouteHandler`. Use it when you are not on
 * Next.js, or when you want plain fetch semantics (streaming, custom headers).
 *
 * As with the Server Action client, `Api` is a type-only import (erased), so no
 * backend URL/paths/openapi ship to the browser.
 */
import { createRpcClient, httpTransport } from '@developerehsan/api-client/browser';
import type { Api } from './api.config';

export const apiHttp = createRpcClient<Api>(
  httpTransport({
    // Same-origin path → cookies ride along (so `authorize`'s cookie check works)
    // and the route's same-origin CSRF check passes.
    endpoint: '/api/rpc',
  }),
);
