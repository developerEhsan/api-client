/**
 * `defineModule` — the authoring entry point for custom modules.
 *
 * Validates the module shape eagerly (spec M6: throw {@link ConfigurationError}
 * on an invalid shape) and stamps a non-enumerable brand so `createClient` can
 * distinguish a module definition from a plain `boolean` toggle in
 * `modules` config.
 */

import { ConfigurationError } from '../errors/ConfigurationError';
import type { ModuleDefinition, ModuleMethods } from '../types/module.types';

/** Symbol brand marking a value produced by {@link defineModule}. */
const MODULE_BRAND: unique symbol = Symbol.for('@developerehsan/api-client.moduleDefinition');

/** A {@link ModuleDefinition} carrying the internal {@link MODULE_BRAND}. */
export type BrandedModuleDefinition<M extends ModuleMethods = ModuleMethods> =
  ModuleDefinition<M> & { readonly [MODULE_BRAND]: true };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Type guard used by `createClient` to detect a branded module definition among
 * the heterogeneous `modules` config entries.
 */
export function isModuleDefinition(value: unknown): value is BrandedModuleDefinition {
  if (typeof value !== 'object' || value === null) return false;
  return (value as Record<PropertyKey, unknown>)[MODULE_BRAND] === true;
}

/**
 * Declare a custom module. Each method receives a
 * {@link import('../types/module.types').ModuleContext} as its first argument,
 * which is stripped from the exposed `api.<module>.<method>` signature.
 *
 * @throws {ConfigurationError} when the definition shape is invalid (M6).
 *
 * @example
 * ```ts
 * import { createClient, defineModule } from '@developerehsan/api-client'
 *
 * const pet = defineModule({
 *   methods: {
 *     // `ctx` is dropped from the caller signature: api.pet.getPetById(1)
 *     getPetById: (ctx, petId: number) =>
 *       ctx.request({ method: 'GET', path: '/pet/{petId}', pathParams: { petId } }),
 *     findPetsByStatus: (ctx, status: string) =>
 *       ctx.request({ method: 'GET', path: '/pet/findByStatus', query: { status } }),
 *   },
 * })
 *
 * const api = createClient({
 *   baseURL: 'https://petstore3.swagger.io/api/v3',
 *   openapi: { mode: 'runtime' },
 *   modules: { pet },
 * })
 * await api.pet.getPetById(1)
 * ```
 */
export function defineModule<M extends ModuleMethods>(
  definition: ModuleDefinition<M>,
): ModuleDefinition<M> {
  if (!isPlainObject(definition)) {
    throw new ConfigurationError('defineModule expects a module definition object.');
  }

  if (definition.extends !== undefined && definition.extends !== 'auto') {
    throw new ConfigurationError(
      `defineModule "extends" must be 'auto' when set, received ${String(definition.extends)}.`,
    );
  }

  if (definition.config !== undefined && !isPlainObject(definition.config)) {
    throw new ConfigurationError('defineModule "config" must be an object when set.');
  }

  const { methods } = definition;
  if (!isPlainObject(methods)) {
    throw new ConfigurationError('defineModule requires a "methods" object.');
  }
  for (const [name, fn] of Object.entries(methods)) {
    if (typeof fn !== 'function') {
      throw new ConfigurationError(
        `defineModule method "${name}" must be a function, received ${typeof fn}.`,
      );
    }
  }

  Object.defineProperty(definition, MODULE_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return definition;
}
