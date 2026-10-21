/**
 * Next.js server-context helpers. In RSC / Server Actions the library must not
 * touch `localStorage`/`window` (spec R2, A9); instead auth tokens and tenant
 * ids are read from the request via `next/headers`.
 *
 * `next/headers` is imported dynamically and guarded so this module is safe to
 * include in any bundle: outside a Next.js server request every reader resolves
 * to `undefined`.
 *
 * These helpers are published from the `/next` subpath, not the root entry, so
 * a non-Next.js app never pulls this module into its graph (issue #41).
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

// Assembled at runtime from fragments so no bundler — including Vite's
// `optimizeDeps` esbuild scan, which does not honor `@vite-ignore` inside a
// pre-bundled dependency — can constant-fold this back into a resolvable
// specifier and try to resolve `next` in a project that does not have it.
const NEXT_HEADERS_SPECIFIER = ['next', 'headers'].join('/');

let nextHeadersModule: NextHeadersModule | null | undefined;

async function loadNextHeaders(): Promise<NextHeadersModule | null> {
  if (nextHeadersModule !== undefined) return nextHeadersModule;
  try {
    nextHeadersModule = (await import(
      /* @vite-ignore */ /* webpackIgnore: true */ NEXT_HEADERS_SPECIFIER
    )) as unknown as NextHeadersModule;
  } catch {
    nextHeadersModule = null;
  }
  return nextHeadersModule;
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
