/**
 * Node-only codegen entry point (subpath export `@developerehsan/api-client/codegen`).
 * Consumed by the CLI; not part of the browser/edge bundle.
 */
export { generate, validate, diff } from './generate';
export type {
  GenerateOptions,
  GenerateResult,
  ReadInputOptions,
  ReadInputResult,
  SchemaMeta,
} from './generate';
export { defineCodegenConfig, loadCodegenConfig, loadCodegenConfigFile } from './config';
export type { CodegenConfig } from './config';
export { watchAndGenerate } from './watch';
export { withApiClientCodegen } from './next';
export type { WatchController, WatchHandlers } from './watch';
export { parseOpenApi } from './parser';
export { emitTypes } from './typeEmitter';
export type { EmitTypesOptions } from './typeEmitter';
export { emitModules, emitRpcModules } from './moduleEmitter';
export type { EmitModulesOptions } from './moduleEmitter';
export { emitReactQueryHooks } from './hooksEmitter';
export type { EmitHooksOptions } from './hooksEmitter';
