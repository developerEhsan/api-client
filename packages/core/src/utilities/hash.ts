/**
 * Deterministic, dependency-free hashing used for cache keys, dedup keys, and
 * schema drift detection. FNV-1a (32-bit) — reproducible across runs and
 * environments, never random/crypto.
 */

/** FNV-1a 32-bit hash of a string, as an 8-char zero-padded hex string. */
export function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Deterministically serialize a value with object keys sorted recursively, so
 * semantically-equal values hash identically regardless of property order.
 */
export function stableStringify(value: unknown): string {
  return (
    JSON.stringify(value, (_key, val: unknown) => {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const record = val as Record<string, unknown>
        const sorted: Record<string, unknown> = {}
        for (const key of Object.keys(record).sort()) sorted[key] = record[key]
        return sorted
      }
      return val
    }) ?? 'null'
  )
}

/** Stable hash of an arbitrary value (order-independent for objects). */
export function stableHash(value: unknown): string {
  return fnv1aHex(stableStringify(value))
}
