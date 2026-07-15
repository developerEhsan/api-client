/**
 * Edge-safe HTTP adapter built on the global {@link fetch}. No Node imports,
 * no runtime dependencies.
 */

import type { AdapterResponse, ApiRequest, ResponseType } from '../../types/http.types';
import type { HttpAdapter } from './adapterInterface';

/** Flatten a {@link Headers} instance into a plain record. */
function flattenHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/** True for plain JSON-serializable objects (not Blob/FormData/ArrayBuffer/etc.). */
function isPlainBody(body: unknown): boolean {
  if (body === null || typeof body !== 'object') return false;
  if (body instanceof Blob) return false;
  if (body instanceof ArrayBuffer) return false;
  if (body instanceof FormData) return false;
  if (body instanceof URLSearchParams) return false;
  if (ArrayBuffer.isView(body)) return false;
  return true;
}

/** Parse a fetch Response body according to the requested response type. */
async function parseBody(response: Response, responseType: ResponseType): Promise<unknown> {
  // 204 No Content / empty body -> null (N3/N7).
  if (response.status === 204 || response.status === 205) return null;

  switch (responseType) {
    case 'blob':
      return response.blob();
    case 'arraybuffer':
      return response.arrayBuffer();
    case 'text':
      return response.text();
    default: {
      const text = await response.text();
      if (text.length === 0) return null;
      // A non-JSON body (e.g. an HTML 5xx error page, spec N4/N8) must not throw
      // here — that would discard the HTTP status and misclassify the failure as
      // a network error. Fall back to the raw string so the pipeline can
      // classify it by status and attach it as rawBody.
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    }
  }
}

/**
 * Create an {@link HttpAdapter} backed by the global `fetch`.
 *
 * Does not throw on non-2xx responses — those resolve as an
 * {@link AdapterResponse}. Genuine network failures reject (fetch rejects).
 */
export function createFetchAdapter(): HttpAdapter {
  return {
    async send(request: ApiRequest): Promise<AdapterResponse> {
      const responseType: ResponseType = request.responseType ?? 'json';
      const headers: Record<string, string> = { ...request.headers };

      let body: BodyInit | undefined;
      if (request.body !== undefined && request.body !== null) {
        if (typeof request.body === 'string') {
          body = request.body;
        } else if (isPlainBody(request.body)) {
          body = JSON.stringify(request.body);
          if (!hasHeader(headers, 'content-type')) {
            headers['Content-Type'] = 'application/json';
          }
        } else {
          body = request.body as BodyInit;
        }
      }

      const init: RequestInit = {
        method: request.method,
        headers,
      };
      if (body !== undefined) init.body = body;
      if (request.signal) init.signal = request.signal;
      if (request.meta?.['cookieAuth'] === true) init.credentials = 'include';

      const response = await fetch(request.url, init);
      const data = await parseBody(response, responseType);

      return {
        status: response.status,
        statusText: response.statusText,
        headers: flattenHeaders(response.headers),
        data,
      };
    },
  };
}

/** Case-insensitive header presence check. */
function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}
