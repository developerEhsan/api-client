/**
 * Node-only codegen entry point (subpath export `@developerEhsan/api-client/codegen`).
 * Consumed by the CLI; not part of the browser/edge bundle.
 */
export { generate, validate, diff } from './generate'
export type { GenerateOptions, GenerateResult } from './generate'
export { parseOpenApi } from './parser'
export { emitTypes } from './typeEmitter'
export type { EmitTypesOptions } from './typeEmitter'
export { emitModules } from './moduleEmitter'
export type { EmitModulesOptions } from './moduleEmitter'
