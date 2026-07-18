import { rpc } from '@/app/actions';
/**
 * SSR RPC bridge — browser side. This `api` mirrors the real client's surface
 * (`api.products.getProductById(...)`) but every call is serialized to the `rpc`
 * Server Action instead of hitting the backend directly. It is safe to import
 * from client components: `Api` is a type-only import (erased at build), so no
 * base URL, no paths, and no OpenAPI data are bundled here.
 *
 *   await api.products.getProductById({ id: 1 }) // → Product, fully typed
 *
 * The network tab shows only a POST to the same origin carrying
 * `{ module, method, args }`. With `{ batch: true }`, calls made in the same
 * tick are coalesced into ONE round-trip (each still validated individually
 * server-side).
 */
import { createRpcClient, serverActionTransport } from '@developerehsan/api-client/browser';
import type { Api } from './api.config';

export const api = createRpcClient<Api>(serverActionTransport(rpc), { batch: true });
export type RpcApi = typeof api;
