/**
 * Optional HTTP adapter backed by axios. axios is a peer dependency and is
 * imported lazily, so fetch-only / edge builds never load it.
 */

import type { AdapterResponse, ApiRequest, ResponseType } from '../../types/http.types';
import type { HttpAdapter } from './adapterInterface';

/**
 * True for a body that carries (or needs the runtime to generate) its own
 * Content-Type: FormData needs a multipart boundary, URLSearchParams its form
 * encoding, a Blob its own type.
 */
function isSelfTypedBody(body: unknown): boolean {
  return (
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
    (typeof Blob !== 'undefined' && body instanceof Blob)
  );
}

/**
 * Minimal structural shape of the axios surface we rely on. Kept local so the
 * package has no hard type dependency on axios.
 */
interface AxiosResponseLike {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: unknown;
}

interface AxiosRequestConfigLike {
  url: string;
  method: string;
  headers: Record<string, string>;
  data?: unknown;
  responseType?: ResponseType;
  signal?: AbortSignal;
  timeout?: number;
  withCredentials?: boolean;
  validateStatus: (status: number) => boolean;
}

interface AxiosInstanceLike {
  request(config: AxiosRequestConfigLike): Promise<AxiosResponseLike>;
}

/**
 * Create an {@link HttpAdapter} backed by axios.
 *
 * @param instance - Optional pre-configured axios instance. When omitted, the
 * default axios export is used (imported lazily on first request).
 *
 * Configures `validateStatus: () => true` so non-2xx responses resolve as an
 * {@link AdapterResponse} rather than rejecting; classification happens in the
 * pipeline.
 */
export function createAxiosAdapter(instance?: AxiosInstanceLike): HttpAdapter {
  let cached: AxiosInstanceLike | undefined = instance;

  async function resolveInstance(): Promise<AxiosInstanceLike> {
    if (cached) return cached;
    const { default: axios } = (await import('axios')) as {
      default: AxiosInstanceLike;
    };
    cached = axios;
    return cached;
  }

  return {
    async send(request: ApiRequest): Promise<AdapterResponse> {
      const axios = await resolveInstance();
      const responseType: ResponseType = request.responseType ?? 'json';

      const config: AxiosRequestConfigLike = {
        url: request.url,
        method: request.method,
        headers: { ...request.headers },
        responseType,
        validateStatus: () => true,
      };
      if (request.body !== undefined) {
        config.data = request.body;
        // Let axios/the runtime set the multipart boundary or form encoding —
        // a configured `application/json` header would corrupt the body (#38).
        if (isSelfTypedBody(request.body)) {
          for (const key of Object.keys(config.headers as Record<string, string>)) {
            if (key.toLowerCase() === 'content-type') {
              delete (config.headers as Record<string, string>)[key];
            }
          }
        }
      }
      if (request.signal) config.signal = request.signal;
      if (request.timeout !== undefined) config.timeout = request.timeout;
      if (request.meta?.['cookieAuth'] === true) config.withCredentials = true;

      const response = await axios.request(config);

      return {
        status: response.status,
        statusText: response.statusText,
        headers: { ...response.headers },
        data: response.data,
      };
    },
  };
}
