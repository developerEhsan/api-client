/**
 * `createTypedClient` — the bridge between codegen output and a runtime client.
 *
 * The CLI emits two things from your OpenAPI spec:
 *   1. `OperationsMap` (a TYPE) in `api.types.ts` — the shape of every operation.
 *   2. `generatedModules` (a VALUE) in `api.modules.ts` — method → { method, path, operationId }.
 *
 * `createTypedClient` consumes both: it builds real callable methods from the
 * descriptor value at runtime, and maps them to the `OperationsMap` type so you
 * get full autocomplete and inference:
 *
 *   const api = createTypedClient<OperationsMap>(config, generatedModules)
 *   const pet = await api.pet.getPetById({ petId: 1 })   // pet: Pet
 *
 * Input convention (a single object per call):
 *   - path placeholders (e.g. `{petId}`) are read from matching keys
 *   - a `body` key becomes the request body
 *   - every other key becomes a query parameter
 * so `api.pet.updatePetWithForm({ petId: 1, name: 'Rex' })` sends petId in the
 * path and name in the query, while `api.store.placeOrder({ body: order })`
 * sends the body.
 */
import type {
  GlobalConfig,
  ModuleConfig,
  ModulesConfig,
  PerCallConfig,
} from '../types/config.types';
import type { ApiResponse, HttpMethod } from '../types/http.types';
import type {
  ModuleContext,
  ModuleDefinition,
  ModuleMethods,
  ModuleRequestSpec,
} from '../types/module.types';
import { type ApiClient, createClient } from './createClient';
import { defineModule } from './createModule';

/** One generated method descriptor (matches codegen `generatedModules`). */
export interface GeneratedMethodDescriptor {
  method: HttpMethod;
  path: string;
  isPaginated?: boolean;
  operationId: string;
}

/** module → method → descriptor (the shape of `generatedModules`). */
export type GeneratedModuleMap = Record<string, Record<string, GeneratedMethodDescriptor>>;

/** Merge an operation's params + query + body into one caller input object. */
type OperationInput<Op> = (Op extends { params: infer P } ? P : object) &
  (Op extends { query: infer Q } ? Q : object) &
  (Op extends { body: infer B } ? ([B] extends [never] ? object : { body: B }) : object);

type OperationResponse<Op> = Op extends { response: infer R } ? R : unknown;

/**
 * The typed method. If the input has no required fields it becomes optional, so
 * `api.store.getInventory()` and `api.pet.getPetById({ petId: 1 })` both typecheck.
 */
type TypedMethod<Op> = object extends OperationInput<Op>
  ? (input?: OperationInput<Op>, perCall?: PerCallConfig) => Promise<OperationResponse<Op>>
  : (input: OperationInput<Op>, perCall?: PerCallConfig) => Promise<OperationResponse<Op>>;

/** Map the descriptor map + OperationsMap into a typed `module.method()` tree. */
export type TypedModules<Ops, Desc extends GeneratedModuleMap> = {
  [M in keyof Desc]: {
    [K in keyof Desc[M]]: Desc[M][K] extends { operationId: infer Id }
      ? Id extends keyof Ops
        ? TypedMethod<Ops[Id]>
        : (input?: unknown, perCall?: PerCallConfig) => Promise<unknown>
      : never;
  };
};

// ---------------------------------------------------------------------------
// Typed module context (`ctx`)
//
// Every module method receives a `ctx` as its first argument. On a typed client
// that `ctx` is derived from the generated spec: `ctx.request` autocompletes the
// known endpoint paths and derives the method/body/query/pathParams + response
// from the chosen (path, method), while still accepting an arbitrary path; and
// `ctx.client` is typed to the generated module tree for composed calls.
// ---------------------------------------------------------------------------

/** Union of every path string across the generated descriptor map. */
type KnownPath<Desc extends GeneratedModuleMap> = {
  [M in keyof Desc]: { [K in keyof Desc[M]]: Desc[M][K]['path'] }[keyof Desc[M]];
}[keyof Desc];

/** Union of the HTTP methods declared for a given `path`. */
type MethodForPath<Desc extends GeneratedModuleMap, P> = {
  [M in keyof Desc]: {
    [K in keyof Desc[M]]: Desc[M][K] extends { path: P; method: infer Me } ? Me : never;
  }[keyof Desc[M]];
}[keyof Desc];

/** The `operationId` registered at a `(path, method)` pair, if any. */
type OpIdAt<Desc extends GeneratedModuleMap, P, Me> = {
  [M in keyof Desc]: {
    [K in keyof Desc[M]]: Desc[M][K] extends { path: P; method: Me; operationId: infer Id }
      ? Id
      : never;
  }[keyof Desc[M]];
}[keyof Desc];

/** The `OperationsMap` entry for a `(path, method)` pair, or `never` if unknown. */
type OpAt<Ops, Desc extends GeneratedModuleMap, P, Me> = OpIdAt<Desc, P, Me> extends infer Id
  ? Id extends keyof Ops
    ? Ops[Id]
    : never
  : never;

type ParamsFor<Ops, Desc extends GeneratedModuleMap, P, Me> = OpAt<Ops, Desc, P, Me> extends {
  params: infer X;
}
  ? X
  : Record<string, string | number>;
type QueryFor<Ops, Desc extends GeneratedModuleMap, P, Me> = OpAt<Ops, Desc, P, Me> extends {
  query: infer X;
}
  ? X
  : Record<string, unknown>;
type BodyFor<Ops, Desc extends GeneratedModuleMap, P, Me> = OpAt<Ops, Desc, P, Me> extends {
  body: infer X;
}
  ? [X] extends [never]
    ? unknown
    : X
  : unknown;
type ResponseFor<Ops, Desc extends GeneratedModuleMap, P, Me> = OpAt<Ops, Desc, P, Me> extends {
  response: infer R;
}
  ? R
  : unknown;

/**
 * The `ctx.request` primitive on a typed client. The first overload triggers for
 * a known `path`: `method` autocompletes the verbs for that path, and
 * `pathParams`/`query`/`body`/response are derived from the matching operation.
 * The second overload keeps arbitrary paths working with a loose spec.
 */
export interface TypedRequest<Ops, Desc extends GeneratedModuleMap> {
  <P extends KnownPath<Desc>, Me extends MethodForPath<Desc, P>>(
    spec: {
      method: Me;
      path: P;
      pathParams?: ParamsFor<Ops, Desc, P, Me>;
      query?: QueryFor<Ops, Desc, P, Me>;
      body?: BodyFor<Ops, Desc, P, Me>;
    },
    perCall?: PerCallConfig,
  ): Promise<ApiResponse<ResponseFor<Ops, Desc, P, Me>>>;
  <T = unknown>(spec: ModuleRequestSpec, perCall?: PerCallConfig): Promise<ApiResponse<T>>;
}

/**
 * The `ctx` passed to every module method on a typed client.
 *
 * `client` is typed to the *generated* module tree (`TypedModules`), not the
 * fully-reshaped final `api` — the latter would be circular, since the final
 * shape is what these methods help define. Composed cross-module calls against
 * generated methods are still fully typed.
 */
export interface TypedModuleContext<Ops, Desc extends GeneratedModuleMap> {
  request: TypedRequest<Ops, Desc>;
  readonly client: TypedModules<Ops, Desc>;
  readonly moduleName: string;
}

// ---------------------------------------------------------------------------
// Module config shape + exposure
// ---------------------------------------------------------------------------

/** A single method in a typed-client `modules` config: `ctx` first, then free. */
export type ConfigModuleMethod<Ops, Desc extends GeneratedModuleMap> = (
  ctx: TypedModuleContext<Ops, Desc>,
  // biome-ignore lint/suspicious/noExplicitAny: variadic user methods accept arbitrary args.
  ...args: any[]
  // biome-ignore lint/suspicious/noExplicitAny: user methods return arbitrary values.
) => any;

/** A module definition in a typed-client `modules` config. */
export interface ConfigModuleDefinition<Ops, Desc extends GeneratedModuleMap> {
  extends?: 'auto';
  config?: ModuleConfig;
  methods: Record<string, ConfigModuleMethod<Ops, Desc>>;
}

/**
 * The shape accepted by `config.modules` on a typed client. This is deliberately
 * *loose* — an open index signature with no per-module named keys — for two
 * reasons: (1) it never "steals" the generated module names from inference, so
 * `Mods` captures the full concrete config (any override wins, custom methods
 * appear); (2) it types `ctx` on every method while leaving inputs and return
 * types entirely to the developer. For method-*name* autocomplete on a known
 * module, opt into {@link createModuleDefiner}.
 */
export type TypedModulesConfig<Ops, Desc extends GeneratedModuleMap> = {
  auto?: boolean;
} & {
  [moduleName: string]: ConfigModuleDefinition<Ops, Desc> | boolean | undefined;
};

/** Strip the leading `ctx` param, preserving the developer's exact args + return. */
type ExposedConfigMethod<F> = F extends (ctx: never, ...args: infer A) => infer R
  ? (...args: A) => R
  : never;

/** Expose one config module definition as an `api.<module>.<method>` tree. */
type ExposedConfigModule<D> = D extends { methods: infer M }
  ? { [K in keyof M]: ExposedConfigMethod<M[K]> }
  : never;

/**
 * Project the user's `modules` config down to the module definitions it declares,
 * exposed as `api.<module>.<method>` trees. `auto` and plain `boolean` toggles
 * contribute nothing. When `modules` is omitted (or defaulted), `Mods` still has
 * a string index signature — detect that and contribute nothing.
 */
type ConfigModules<Mods> = string extends keyof Mods
  ? object
  : {
      [M in keyof Mods as M extends 'auto'
        ? never
        : Mods[M] extends { methods: Record<string, (...args: never[]) => unknown> }
          ? M
          : never]: ExposedConfigModule<Mods[M]>;
    };

/**
 * Merge the generated module tree with the config-supplied one. Config wins:
 * a module present in both has its generated methods overlaid by the config
 * methods (per-method), and config-only modules are added wholesale. This is why
 * the config is the final source of truth — the types you declare survive a
 * regenerate.
 */
type MergeModuleTrees<Gen, Cfg> = {
  [K in keyof Gen | keyof Cfg]: K extends keyof Cfg
    ? K extends keyof Gen
      ? Omit<Gen[K], keyof Cfg[K]> & Cfg[K]
      : Cfg[K]
    : K extends keyof Gen
      ? Gen[K]
      : never;
};

/** The client returned by {@link createTypedClient}: utilities + typed modules. */
export type TypedApiClient<Ops, Desc extends GeneratedModuleMap, Mods = object> = ApiClient &
  MergeModuleTrees<TypedModules<Ops, Desc>, ConfigModules<Mods>>;

/**
 * Method hints for a *known* module used by {@link createModuleDefiner}: each
 * existing method name is offered (optionally) with its `ctx` + operation-typed
 * `input`, but the return type is `Promise<unknown>` so whatever you return is
 * accepted and inferred verbatim — no restriction on the response shape.
 */
export type ModuleMethodHints<
  Ops,
  Desc extends GeneratedModuleMap,
  Methods extends Record<string, GeneratedMethodDescriptor>,
> = Partial<{
  [K in keyof Methods]: Methods[K] extends { operationId: infer Id }
    ? Id extends keyof Ops
      ? (
          ctx: TypedModuleContext<Ops, Desc>,
          input: OperationInput<Ops[Id]>,
          perCall?: PerCallConfig,
        ) => Promise<unknown>
      : ModuleMethods[string]
    : ModuleMethods[string];
}>;

/** The definer function returned by {@link createModuleDefiner}. */
export interface ModuleDefiner<Ops, Mods extends GeneratedModuleMap> {
  /**
   * Define/override a *known* generated module. Passing its name as the first
   * argument resolves the exact operation set, so method names and their
   * `input` types autocomplete reliably (works in JS via JSDoc too). Method
   * return types stay whatever your implementation returns.
   */
  <Name extends keyof Mods & string, M extends ModuleMethods>(
    name: Name,
    definition: {
      extends?: 'auto';
      config?: ModuleConfig;
      methods: M & ModuleMethodHints<Ops, Mods, Mods[Name]>;
    },
  ): ModuleDefinition<M>;
  /** Define a *brand-new* module (name not in the generated map). */
  <M extends ModuleMethods>(name: string, definition: ModuleDefinition<M>): ModuleDefinition<M>;
}

/**
 * Create a module definer bound to your generated `OperationsMap` and module
 * map. Bind it once, then author modules with reliable autocomplete:
 *
 *   const defineModule = createModuleDefiner<OperationsMap, typeof generatedModules>()
 *   // ...
 *   store: defineModule('store', {
 *     methods: {
 *       deleteOrder: async (ctx, input) => { input.orderId // typed
 *         return { ok: true } },              // return shape is unrestricted
 *     },
 *   })
 *
 * The name argument is type-level only — the module's real name is still its
 * key in `modules`. At runtime this defers to {@link defineModule} for the same
 * eager validation + branding.
 *
 * @example
 * ```ts
 * import { createModuleDefiner } from '@developerehsan/api-client'
 * import type { OperationsMap } from './generated/api.types'
 * import { generatedModules } from './generated/api.modules'
 *
 * const defineModule = createModuleDefiner<OperationsMap, typeof generatedModules>()
 *
 * const store = defineModule('store', {
 *   methods: {
 *     // `input.orderId` is typed from the generated operation; return shape is free
 *     deleteOrder: async (ctx, input) => {
 *       await ctx.request({ method: 'DELETE', path: '/store/order/{orderId}', pathParams: input })
 *       return { deleted: true }
 *     },
 *   },
 * })
 * ```
 */
export function createModuleDefiner<Ops, Mods extends GeneratedModuleMap>(): ModuleDefiner<
  Ops,
  Mods
> {
  return ((_name: string, definition: ModuleDefinition) =>
    defineModule(definition)) as ModuleDefiner<Ops, Mods>;
}

/** Extract `{placeholder}` names from a path template. */
function pathPlaceholders(path: string): Set<string> {
  const names = new Set<string>();
  const re = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: canonical regex exec() iteration idiom.
  while ((match = re.exec(path)) !== null) {
    if (match[1]) names.add(match[1]);
  }
  return names;
}

/**
 * Turn a descriptor map into a runtime {@link ModulesConfig}. Each method splits
 * its single input object into pathParams / query / body and runs the pipeline
 * via `ctx.request`, returning the unwrapped `.data`.
 *
 * Usually called for you by {@link createTypedClient}; call it directly only to
 * inspect or post-process the generated modules before wiring your own client.
 *
 * @example
 * ```ts
 * import { buildModulesFromDescriptors, createClient } from '@developerehsan/api-client'
 * import { generatedModules } from './generated/api.modules'
 *
 * const modules = buildModulesFromDescriptors(generatedModules)
 * const api = createClient({
 *   baseURL: 'https://petstore3.swagger.io/api/v3',
 *   openapi: { mode: 'runtime' },
 *   modules,
 * })
 * const pet = await api.pet.getPetById({ petId: 1 }) // -> unwrapped .data
 * ```
 */
export function buildModulesFromDescriptors(descriptors: GeneratedModuleMap): ModulesConfig {
  const modules: ModulesConfig = { auto: false };

  for (const [moduleName, methods] of Object.entries(descriptors)) {
    const methodDefs: Record<
      string,
      (ctx: ModuleContext, input?: unknown, perCall?: PerCallConfig) => Promise<unknown>
    > = {};

    for (const [methodName, descriptor] of Object.entries(methods)) {
      const placeholders = pathPlaceholders(descriptor.path);

      methodDefs[methodName] = async (ctx, input?, perCall?) => {
        const pathParams: Record<string, string | number> = {};
        const query: Record<string, unknown> = {};
        let body: unknown;

        if (input !== undefined && input !== null) {
          if (typeof input === 'object' && !Array.isArray(input)) {
            for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
              if (key === 'body') body = value;
              else if (placeholders.has(key)) pathParams[key] = value as string | number;
              else query[key] = value;
            }
          } else {
            // Raw non-object input (array/string) is treated as the body.
            body = input;
          }
        }

        const response = await ctx.request(
          {
            method: descriptor.method,
            path: descriptor.path,
            pathParams,
            query,
            ...(body !== undefined ? { body } : {}),
          },
          perCall,
        );
        return response.data;
      };
    }

    modules[moduleName] = defineModule({ methods: methodDefs as unknown as ModuleMethods });
  }

  return modules;
}

/**
 * Create a client whose modules are built from generated descriptors and typed
 * against the generated `OperationsMap`.
 *
 * Curried so you pass `OperationsMap` explicitly while the descriptor type is
 * inferred from the value (TypeScript can't partially infer a single call):
 *
 *   const api = createTypedClient<OperationsMap>()(config, generatedModules)
 *
 * @typeParam Ops - the generated `OperationsMap` type.
 * @returns a factory taking `(config, descriptors)`. `config.modules`, if
 * present, is merged over the generated modules so you can add custom methods.
 *
 * @example
 * ```ts
 * import { createTypedClient } from '@developerehsan/api-client'
 * import type { OperationsMap } from './generated/api.types'
 * import { generatedModules } from './generated/api.modules'
 *
 * const api = createTypedClient<OperationsMap>()(
 *   { baseURL: 'https://petstore3.swagger.io/api/v3', openapi: { mode: 'runtime' } },
 *   generatedModules,
 * )
 *
 * const pet = await api.pet.getPetById({ petId: 1 })         // pet: Pet
 * const available = await api.pet.findPetsByStatus({ status: 'available' }) // Pet[]
 * ```
 */
export function createTypedClient<Ops>() {
  return <
    Desc extends GeneratedModuleMap,
    Mods extends TypedModulesConfig<Ops, Desc> = TypedModulesConfig<Ops, Desc>,
  >(
    config: Omit<GlobalConfig, 'modules'> & { modules?: Mods },
    descriptors: Desc,
  ): TypedApiClient<Ops, Desc, Mods> => {
    const generated = buildModulesFromDescriptors(descriptors);
    // The typed config carries a richer `ctx` type than the runtime
    // `ModulesConfig`; the runtime shape is structurally compatible, so narrow
    // at this boundary.
    const configModules = (config.modules ?? {}) as unknown as ModulesConfig;

    // Merge config over generated PER METHOD (not whole-module): a config module
    // that overrides `store` must keep the generated `store` methods it didn't
    // touch. This mirrors the type-level `MergeModuleTrees` (config wins per
    // method) — a shallow `{ ...generated, ...config }` would drop them.
    const modules: ModulesConfig = { ...generated };
    for (const [name, value] of Object.entries(configModules)) {
      const gen = generated[name];
      if (
        value &&
        typeof value === 'object' &&
        gen &&
        typeof gen === 'object' &&
        'methods' in value &&
        'methods' in gen
      ) {
        const genDef = gen as ModuleDefinition;
        const cfgDef = value as ModuleDefinition;
        modules[name] = defineModule({
          ...genDef,
          ...cfgDef,
          methods: { ...genDef.methods, ...cfgDef.methods },
        });
      } else {
        modules[name] = value;
      }
    }

    const client = createClient({ ...config, modules });
    return client as unknown as TypedApiClient<Ops, Desc, Mods>;
  };
}
