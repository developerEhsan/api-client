/**
 * Next.js-only entry: `@developerehsan/api-client/next`.
 *
 * Everything here reaches for `next/headers`, so it lives behind its own
 * subpath. Projects that are not Next.js never import this module and so never
 * make a bundler try to resolve `next` (issue #41).
 */

export {
  readServerHeader,
  readServerCookie,
  serverTenantResolver,
  serverTokenFromCookie,
} from '../environment/serverContext';
