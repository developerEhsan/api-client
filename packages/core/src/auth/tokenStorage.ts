/**
 * Reference `TokenStorage` adapters (spec 05), mirroring the
 * `PersistentCacheStore` adapter pattern (`cache-stores/index.ts`).
 */
import type { OAuth2Tokens, TokenStorage } from '../types/auth.types';

/**
 * In-memory token storage. Handy for tests and SSR warm-up — does not
 * survive a process restart or page reload.
 *
 * @example
 * import { createMemoryTokenStorage } from '@developerehsan/api-client'
 *
 * auth: { strategy: 'oauth2', tokenStorage: createMemoryTokenStorage(), ... }
 */
export function createMemoryTokenStorage(): TokenStorage {
  let tokens: OAuth2Tokens | null = null;
  return {
    getTokens: () => tokens,
    setTokens: (next) => {
      tokens = next;
    },
    clearTokens: () => {
      tokens = null;
    },
  };
}

/** Options for {@link createLocalStorageTokenStorage}. */
export interface LocalStorageTokenStorageOptions {
  /** localStorage key tokens are stored under. @default 'developerehsan-api-tokens' */
  key?: string;
}

/**
 * Browser `localStorage`-backed token storage. No-ops (resolving `null`/void)
 * when `localStorage` is unavailable, so it's safe to construct in any
 * environment — feature-detected the same way `createIndexedDbStore` detects
 * `indexedDB`.
 *
 * SECURITY: `localStorage` is readable by any script on the page (XSS risk).
 * This is a plain-JS reference adapter, not a hardened one — for
 * `httpOnly` cookie-backed sessions, tokens must be set by a server route,
 * never by client-side JS (an `httpOnly` cookie cannot be read/written from
 * JS by design). If your backend uses `httpOnly` cookies, use
 * `strategy: 'cookie'` instead of `tokenStorage`, and skip this adapter.
 *
 * @example
 * import { createLocalStorageTokenStorage } from '@developerehsan/api-client'
 *
 * auth: { strategy: 'oauth2', tokenStorage: createLocalStorageTokenStorage(), ... }
 */
export function createLocalStorageTokenStorage(
  options: LocalStorageTokenStorageOptions = {},
): TokenStorage {
  const key = options.key ?? 'developerehsan-api-tokens';
  const storage: Storage | undefined = (globalThis as { localStorage?: Storage }).localStorage;

  return {
    getTokens: () => {
      if (!storage) return null;
      try {
        const raw = storage.getItem(key);
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof (parsed as { accessToken?: unknown }).accessToken === 'string'
        ) {
          return parsed as OAuth2Tokens;
        }
        return null;
      } catch {
        return null;
      }
    },
    setTokens: (tokens) => {
      if (!storage) return;
      try {
        storage.setItem(key, JSON.stringify(tokens));
      } catch {
        /* storage full/unavailable — never break the refresh flow over persistence */
      }
    },
    clearTokens: () => {
      if (!storage) return;
      try {
        storage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}
