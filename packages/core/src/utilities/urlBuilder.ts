/**
 * Pure URL construction: path-template substitution, base/path normalization,
 * and query serialization. No IO.
 */

import { ConfigurationError } from '../errors/ConfigurationError'

/** Input to {@link buildUrl}. */
export interface BuildUrlInput {
  /** Base URL, e.g. `https://api.example.com` (trailing slash tolerated). */
  baseURL: string
  /** Path template, e.g. `/invoices/{id}`. */
  path: string
  /** Values substituted into `{param}` placeholders in the path. */
  pathParams?: Record<string, string | number>
  /** Query params appended to the URL (undefined/null skipped). */
  query?: Record<string, unknown>
}

/** Match `{name}` placeholders in a path template. */
const PLACEHOLDER = /\{([^{}]+)\}/g

/**
 * Substitute `{param}` placeholders, normalize base/path joining, and append a
 * serialized query string, returning an absolute URL.
 *
 * - Throws {@link ConfigurationError} when a `{param}` in the path has no value
 *   in `pathParams` (E4).
 * - Strips trailing slashes from `baseURL` and ensures the path carries a
 *   single leading slash (E5).
 */
export function buildUrl(input: BuildUrlInput): string {
  const { baseURL, path, pathParams, query } = input

  const substituted = path.replace(PLACEHOLDER, (_match, rawName: string) => {
    const name = rawName.trim()
    const value = pathParams?.[name]
    if (value === undefined || value === null) {
      throw new ConfigurationError(
        `Missing required path parameter "${name}" for path "${path}"`,
      )
    }
    return encodeURIComponent(String(value))
  })

  const base = baseURL.replace(/\/+$/, '')
  const normalizedPath = substituted.length === 0
    ? ''
    : `/${substituted.replace(/^\/+/, '')}`

  const url = `${base}${normalizedPath}`
  const qs = serializeQuery(query)
  return qs.length > 0 ? `${url}?${qs}` : url
}

/**
 * Serialize a query object into a `key=value&...` string (no leading `?`).
 *
 * - `undefined` and `null` values are skipped.
 * - Array values repeat the key: `{ id: [1, 2] }` -> `id=1&id=2`.
 * - Booleans and numbers are stringified.
 * - Keys and values are percent-encoded.
 */
export function serializeQuery(query?: Record<string, unknown>): string {
  if (!query) return ''
  const parts: string[] = []

  const append = (key: string, value: unknown): void => {
    if (value === undefined || value === null) return
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(scalarToString(value))}`)
  }

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) append(key, item)
    } else {
      append(key, value)
    }
  }

  return parts.join('&')
}

/** Stringify a scalar query value; objects are JSON-encoded as a fallback. */
function scalarToString(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value)
    default:
      return JSON.stringify(value) ?? ''
  }
}
