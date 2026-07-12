/**
 * Query-key construction. Keys are stable, serializable, and hierarchical so
 * partial invalidation works (spec §7.2, Q12):
 *
 *   ['developerEhsan', module, method, params]
 */
import type { QueryKey } from './types'

/** Root key for a module: `['developerEhsan', module]`. */
export function moduleKey(module: string): readonly ['developerEhsan', string] {
  return ['developerEhsan', module]
}

/**
 * Full key for a method call. `params` is appended only when defined so that
 * parameterless calls produce a shorter, still-hierarchical key.
 */
export function methodKey(module: string, method: string, params?: unknown): QueryKey {
  if (params === undefined || params === null) {
    return ['developerEhsan', module, method]
  }
  return ['developerEhsan', module, method, params]
}
