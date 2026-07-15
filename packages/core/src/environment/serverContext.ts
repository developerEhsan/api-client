/**
 * Next.js server-context helpers. In RSC / Server Actions the library must not
 * touch `localStorage`/`window` (spec R2, A9); instead auth tokens and tenant
 * ids are read from the request via `next/headers`.
 *
 * `next/headers` is imported dynamically and guarded so this module is safe to
 * include in any bundle: outside a Next.js server request every reader resolves
 * to `undefined`.
 */

interface NextHeaders {
  get(name: string): string | null;
}
interface NextCookieValue {
  value: string;
}
interface NextCookies {
  get(name: string): NextCookieValue | undefined;
}
interface NextHeadersModule {
  headers: () => NextHeaders | Promise<NextHeaders>;
  cookies: () => NextCookies | Promise<NextCookies>;
}

async function loadNextHeaders(): Promise<NextHeadersModule | null> {
  try {
    // Non-literal specifier keeps bundlers from hard-resolving an optional dep.
    const specifier = 'next/headers';
    return (await import(/* @vite-ignore */ specifier)) as unknown as NextHeadersModule;
  } catch {
    return null;
  }
}

/** Read a request header on the server, or `undefined` outside a Next.js request. */
export async function readServerHeader(name: string): Promise<string | undefined> {
  const mod = await loadNextHeaders();
  if (!mod) return undefined;
  try {
    const store = await mod.headers();
    return store.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Read a request cookie on the server, or `undefined` outside a Next.js request. */
export async function readServerCookie(name: string): Promise<string | undefined> {
  const mod = await loadNextHeaders();
  if (!mod) return undefined;
  try {
    const store = await mod.cookies();
    return store.get(name)?.value ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build a server-safe `getTenantId` that reads the tenant from a request header
 * (default `x-tenant-id`). Use as `tenancy.getTenantId` in RSC configs.
 */
export function serverTenantResolver(headerName = 'x-tenant-id'): () => Promise<string> {
  return async () => (await readServerHeader(headerName)) ?? '';
}

/**
 * Build a server-safe bearer `getToken` that reads an access token from a
 * cookie (default `access_token`). Use as `auth.getToken` in RSC configs.
 */
export function serverTokenFromCookie(cookieName = 'access_token'): () => Promise<string | null> {
  return async () => (await readServerCookie(cookieName)) ?? null;
}
