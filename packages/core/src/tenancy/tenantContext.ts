/**
 * `AsyncLocalStorage`-based tenant context for server runtimes (Next.js RSC,
 * Node). Each concurrent server request runs in its own isolated store, so a
 * tenant id set for one request never leaks into another (spec T5, R8).
 *
 * `async_hooks` is loaded lazily and guarded: in the browser (where it does not
 * exist) every operation degrades gracefully to "no ambient tenant".
 */

interface AsyncLocalStorageLike<T> {
  run<R>(store: T, callback: () => R): R;
  getStore(): T | undefined;
}

interface TenantStore {
  tenantId: string;
}

// Lazily-resolved AsyncLocalStorage instance (or null when unavailable).
let alsPromise: Promise<AsyncLocalStorageLike<TenantStore> | null> | null = null;

async function getStorage(): Promise<AsyncLocalStorageLike<TenantStore> | null> {
  if (alsPromise === null) {
    alsPromise = import('node:async_hooks')
      .then((mod) => {
        const Ctor = mod.AsyncLocalStorage as new () => AsyncLocalStorageLike<TenantStore>;
        return new Ctor();
      })
      .catch(() => null);
  }
  return alsPromise;
}

/**
 * Run `callback` within a tenant context so that {@link getTenantFromContext}
 * (and, transitively, the client's tenant resolution) observes `tenantId` for
 * the duration — across `await` boundaries — without it leaking to sibling
 * async work. Falls back to running `callback` directly where AsyncLocalStorage
 * is unavailable (e.g. the browser).
 */
export async function runWithTenant<T>(
  tenantId: string,
  callback: () => T | Promise<T>,
): Promise<T> {
  const als = await getStorage();
  if (!als) return callback();
  return als.run({ tenantId }, callback);
}

/** The tenant id for the current async context, or `undefined` if none/unavailable. */
export async function getTenantFromContext(): Promise<string | undefined> {
  const als = await getStorage();
  return als?.getStore()?.tenantId;
}

/** True when a server-grade AsyncLocalStorage is available in this runtime. */
export async function hasTenantContext(): Promise<boolean> {
  return (await getStorage()) !== null;
}
