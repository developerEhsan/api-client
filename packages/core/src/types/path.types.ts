/**
 * Compile-time extraction of `{placeholder}` names from a path template, so a
 * request spec can require exactly the path params its path declares — turning a
 * whole class of "missing/typo'd path param" runtime `ConfigurationError`s into
 * type errors.
 */

/** Union of placeholder names in a path template, e.g. `/a/{x}/b/{y}` -> `'x' | 'y'`. */
export type ExtractPathParams<P extends string> =
  P extends `${string}{${infer Name}}${infer Rest}` ? Name | ExtractPathParams<Rest> : never;

/**
 * The `pathParams` requirement for a path `P`:
 *  - when `P` has placeholders, `pathParams` is REQUIRED with exactly those keys;
 *  - when it has none, `pathParams` is optional and empty;
 *  - when `P` is a non-literal `string` (placeholders unknowable), fall back to
 *    the loose record so dynamic paths keep working.
 */
export type PathParamsFor<P extends string> = string extends P
  ? { pathParams?: Record<string, string | number> }
  : [ExtractPathParams<P>] extends [never]
    ? { pathParams?: Record<string, never> }
    : { pathParams: Record<ExtractPathParams<P>, string | number> };
