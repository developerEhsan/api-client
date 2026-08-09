import { hasDomGlobals } from '../environment/detect';
/**
 * Dev-time, opt-in guard for the SSR RPC bridge's trust boundary (spec 06):
 * throw immediately when server-only code is evaluated/called in a browser
 * context, instead of only discovering the leak via CI's
 * `scripts/check-browser-bundle.mjs` grep (which stays the authoritative
 * last line of defense — this is defense-in-depth, not a replacement).
 */
import { ConfigurationError } from '../errors/ConfigurationError';

/**
 * Throws a {@link ConfigurationError} when called in a browser context
 * (`window`+`document` both present — reuses `hasDomGlobals()`, the same
 * DOM-presence primitive `detectEnvironment()` computes `hasDom` from,
 * rather than a second ad-hoc check; unlike `detectEnvironment()` this is
 * NOT memoized, since this guard must reflect the current global state at
 * call time). No-ops everywhere else (Node, edge, workers).
 *
 * The message is intentionally generic — it never echoes the caller's
 * config (`baseURL`, paths, etc.), since that would defeat the very leak
 * this guard exists to catch.
 */
export function assertServerOnly(where: string): void {
  if (hasDomGlobals()) {
    throw new ConfigurationError(
      `${where} must not run in the browser. This would expose backend URLs/paths/credentials that the SSR RPC bridge is designed to hide — see SECURITY.md. If you are seeing this from a bundler, check for an accidental client-side import of a server-only module.`,
    );
  }
}
