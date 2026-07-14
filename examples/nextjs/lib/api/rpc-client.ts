import { rpc } from '@/app/actions';
/**
 * SSR RPC bridge — browser side. This `api` mirrors the real client's surface
 * (`api.pet.getPetById(...)`) but every call is serialized to the `rpc` Server
 * Action instead of hitting the backend directly. It is safe to import from
 * client components: `Api` is a type-only import (erased at build), so no base
 * URL, no paths, and no OpenAPI data are bundled here.
 *
 *   await api.pet.getPetById({ pathParams: { petId: 1 } }) // → Pet, fully typed
 *
 * The network tab shows only a POST to the same origin carrying
 * `{ module, method, args }`.
 */
import { createRpcClient, serverActionTransport } from '@developerEhsan/api-client/browser';
import type { Api } from './api.config';

export const api = createRpcClient<Api>(serverActionTransport(rpc));
export type RpcApi = typeof api;
