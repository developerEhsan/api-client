/**
 * OpenAPI 3.x -> {@link SchemaAST} parser.
 *
 * Self-contained (no external deps). Never throws on unknown or malformed
 * constructs — those degrade to `{ kind: 'unknown' }`. The only hard error is
 * an unsupported document (Swagger 2.x, or a missing/invalid `openapi` field),
 * which throws {@link SchemaParseError}.
 */

import { SchemaParseError } from '../errors/SchemaError';
import type { HttpMethod } from '../types/http.types';
import type {
  OperationMap,
  OperationNode,
  ParameterNode,
  PathMap,
  PropertyNode,
  SchemaAST,
  TagMap,
  TypeNode,
} from '../types/openapi.types';

/** Query parameter names that mark an operation as paginated. */
const PAGINATION_PARAMS: ReadonlySet<string> = new Set([
  'page',
  'limit',
  'offset',
  'cursor',
  'per_page',
  'pageSize',
]);

/** OpenAPI verbs that map onto a supported {@link HttpMethod}. */
const METHODS: ReadonlyArray<[string, HttpMethod]> = [
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
  ['head', 'HEAD'],
  ['options', 'OPTIONS'],
];

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return isRecord(value) ? value : undefined;
}

/** Parse a `#/components/schemas/X` pointer into its component name. */
function refName(ref: string): string | undefined {
  const match = /^#\/components\/schemas\/([^/]+)$/.exec(ref);
  return match?.[1];
}

/** Sanitize an arbitrary string into a safe identifier fragment. */
function sanitizeId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Convert a single (inline or `$ref`) schema object into a {@link TypeNode}.
 * `$ref` becomes a `ref` pointer node rather than being inlined, so cycles are
 * inherently non-recursive. Unresolvable or unrecognized shapes degrade to
 * `{ kind: 'unknown' }`.
 */
function convertSchema(schema: unknown): TypeNode {
  const node = convertSchemaInner(schema);
  // OpenAPI 3.0 `nullable: true` adds a null branch (3.1 uses type arrays,
  // already handled). Avoid double-adding null for enum/union that include it.
  if (isRecord(schema) && schema['nullable'] === true && node.kind !== 'unknown') {
    return { kind: 'union', variants: [node, { kind: 'primitive', type: 'null' }] };
  }
  return node;
}

function convertSchemaInner(schema: unknown): TypeNode {
  if (!isRecord(schema)) return { kind: 'unknown', reason: 'not a schema object' };

  const ref = asString(schema['$ref']);
  if (ref !== undefined) {
    const name = refName(ref);
    return name !== undefined
      ? { kind: 'ref', name }
      : { kind: 'unknown', reason: `unsupported $ref: ${ref}` };
  }

  if (Array.isArray(schema['allOf'])) {
    return { kind: 'intersection', parts: schema['allOf'].map(convertSchema) };
  }
  if (Array.isArray(schema['oneOf'])) {
    return { kind: 'union', variants: schema['oneOf'].map(convertSchema) };
  }
  if (Array.isArray(schema['anyOf'])) {
    return { kind: 'union', variants: schema['anyOf'].map(convertSchema) };
  }

  const format = asString(schema['format']);
  const enumValues = normalizeEnum(schema['enum']);
  const rawType = schema['type'];

  // `type` may be an array (OpenAPI 3.1 nullable style) -> union of primitives.
  if (Array.isArray(rawType)) {
    const variants = rawType
      .map((t) => (typeof t === 'string' ? primitiveNode(t, format, enumValues) : undefined))
      .filter((n): n is TypeNode => n !== undefined);
    if (variants.length === 1) return variants[0] as TypeNode;
    if (variants.length > 1) return { kind: 'union', variants };
    return { kind: 'unknown', reason: 'empty type array' };
  }

  const type = asString(rawType);

  if (type === 'array') {
    return { kind: 'array', items: convertSchema(schema['items']) };
  }

  if (type === 'object' || isRecord(schema['properties'])) {
    return convertObject(schema);
  }

  if (type !== undefined) {
    const node = primitiveNode(type, format, enumValues);
    if (node !== undefined) return node;
  }

  // A bare `enum` with no declared type -> infer primitive from values.
  if (enumValues !== undefined) {
    const inferred = typeof enumValues[0] === 'number' ? 'number' : 'string';
    return { kind: 'primitive', type: inferred, ...(format ? { format } : {}), enum: enumValues };
  }

  return { kind: 'unknown', reason: 'unrecognized schema' };
}

function normalizeEnum(value: unknown): readonly (string | number)[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter(
    (v): v is string | number => typeof v === 'string' || typeof v === 'number',
  );
  return values.length > 0 ? values : undefined;
}

function primitiveNode(
  type: string,
  format: string | undefined,
  enumValues: readonly (string | number)[] | undefined,
): TypeNode | undefined {
  let normalized: 'string' | 'number' | 'boolean' | 'null';
  switch (type) {
    case 'string':
      normalized = 'string';
      break;
    case 'integer':
    case 'number':
      normalized = 'number';
      break;
    case 'boolean':
      normalized = 'boolean';
      break;
    case 'null':
      normalized = 'null';
      break;
    default:
      return undefined;
  }
  return {
    kind: 'primitive',
    type: normalized,
    ...(format ? { format } : {}),
    ...(enumValues ? { enum: enumValues } : {}),
  };
}

function convertObject(schema: UnknownRecord): TypeNode {
  const properties: Record<string, PropertyNode> = {};
  const required = new Set(
    (Array.isArray(schema['required']) ? schema['required'] : []).filter(
      (r): r is string => typeof r === 'string',
    ),
  );
  const props = asRecord(schema['properties']);
  if (props !== undefined) {
    for (const [key, value] of Object.entries(props)) {
      const propSchema = asRecord(value);
      const description = propSchema ? asString(propSchema['description']) : undefined;
      const deprecated = propSchema ? asBoolean(propSchema['deprecated']) : undefined;
      properties[key] = {
        type: convertSchema(value),
        required: required.has(key),
        ...(description ? { description } : {}),
        ...(deprecated ? { deprecated } : {}),
      };
    }
  }

  const additional = schema['additionalProperties'];
  let additionalProperties: TypeNode | boolean | undefined;
  if (typeof additional === 'boolean') additionalProperties = additional;
  else if (additional !== undefined) additionalProperties = convertSchema(additional);

  return {
    kind: 'object',
    properties,
    ...(additionalProperties !== undefined ? { additionalProperties } : {}),
  };
}

/** Collect the names of every `ref` node reachable within a {@link TypeNode}. */
function collectRefs(node: TypeNode, out: Set<string>): void {
  switch (node.kind) {
    case 'ref':
      out.add(node.name);
      break;
    case 'array':
      collectRefs(node.items, out);
      break;
    case 'object':
      for (const prop of Object.values(node.properties)) collectRefs(prop.type, out);
      if (node.additionalProperties && typeof node.additionalProperties !== 'boolean') {
        collectRefs(node.additionalProperties, out);
      }
      break;
    case 'union':
      for (const v of node.variants) collectRefs(v, out);
      break;
    case 'intersection':
      for (const p of node.parts) collectRefs(p, out);
      break;
    default:
      break;
  }
}

/**
 * Find component names that participate in a `$ref` cycle. Uses a DFS with a
 * `visiting` stack; any node re-entered while on the stack closes a cycle and
 * is recorded.
 */
function detectCircularRefs(components: Record<string, TypeNode>): string[] {
  const edges = new Map<string, Set<string>>();
  for (const [name, node] of Object.entries(components)) {
    const refs = new Set<string>();
    collectRefs(node, refs);
    edges.set(name, refs);
  }

  const circular = new Set<string>();
  const visiting = new Set<string>();
  const done = new Set<string>();

  const visit = (name: string): void => {
    if (done.has(name)) return;
    if (visiting.has(name)) {
      circular.add(name);
      return;
    }
    visiting.add(name);
    for (const next of edges.get(name) ?? []) {
      if (edges.has(next)) visit(next);
    }
    visiting.delete(name);
    done.add(name);
  };

  for (const name of edges.keys()) visit(name);
  return [...circular].sort();
}

/** Resolve a value that may be a local `$ref` against the whole document. */
function resolveLocalRef(doc: UnknownRecord, value: unknown): unknown {
  if (!isRecord(value)) return value;
  const ref = asString(value['$ref']);
  if (ref === undefined) return value;
  if (!ref.startsWith('#/')) return undefined;
  let current: unknown = doc;
  for (const segment of ref.slice(2).split('/')) {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** Extract the `application/json` (or first available) schema from a content map. */
function schemaFromContent(content: unknown): TypeNode {
  const contentMap = asRecord(content);
  if (contentMap === undefined) return { kind: 'unknown', reason: 'no content' };
  const json = asRecord(contentMap['application/json']);
  const chosen = json ?? Object.values(contentMap).find((v): v is UnknownRecord => isRecord(v));
  if (chosen === undefined) return { kind: 'unknown', reason: 'no content schema' };
  return convertSchema(chosen['schema']);
}

function parseParameter(doc: UnknownRecord, raw: unknown): ParameterNode | undefined {
  const resolved = asRecord(resolveLocalRef(doc, raw));
  if (resolved === undefined) return undefined;
  const name = asString(resolved['name']);
  const location = asString(resolved['in']);
  if (name === undefined || location === undefined) return undefined;
  if (
    location !== 'path' &&
    location !== 'query' &&
    location !== 'header' &&
    location !== 'cookie'
  ) {
    return undefined;
  }
  const description = asString(resolved['description']);
  return {
    name,
    in: location,
    // Path params are always required per the spec.
    required: location === 'path' ? true : (asBoolean(resolved['required']) ?? false),
    type: convertSchema(resolved['schema']),
    ...(description ? { description } : {}),
  };
}

function parseOperation(
  doc: UnknownRecord,
  path: string,
  method: HttpMethod,
  operation: UnknownRecord,
  inheritedParams: unknown[],
  usedIds: Set<string>,
): OperationNode {
  const rawParams = [
    ...inheritedParams,
    ...(Array.isArray(operation['parameters']) ? operation['parameters'] : []),
  ];
  const parameters: ParameterNode[] = [];
  for (const raw of rawParams) {
    const parsed = parseParameter(doc, raw);
    if (parsed !== undefined) parameters.push(parsed);
  }

  const isPaginated = parameters.some((p) => p.in === 'query' && PAGINATION_PARAMS.has(p.name));

  // Request body.
  let requestBody: OperationNode['requestBody'];
  const rawBody = asRecord(resolveLocalRef(doc, operation['requestBody']));
  if (rawBody !== undefined) {
    requestBody = {
      required: asBoolean(rawBody['required']) ?? false,
      type: schemaFromContent(rawBody['content']),
    };
  }

  // Responses (including the `default` key).
  const responses: Record<string, TypeNode> = {};
  const rawResponses = asRecord(operation['responses']);
  if (rawResponses !== undefined) {
    for (const [status, value] of Object.entries(rawResponses)) {
      const response = asRecord(resolveLocalRef(doc, value));
      responses[status] =
        response === undefined
          ? { kind: 'unknown', reason: 'unresolved response' }
          : schemaFromContent(response['content']);
    }
  }

  // Stable, unique id.
  const explicitId = asString(operation['operationId']);
  let id = explicitId ? sanitizeId(explicitId) : sanitizeId(`${method}_${path}`);
  if (id.length === 0) id = sanitizeId(`${method}_${path}`);
  if (usedIds.has(id)) {
    let n = 2;
    while (usedIds.has(`${id}_${n}`)) n += 1;
    id = `${id}_${n}`;
  }
  usedIds.add(id);

  const tags = Array.isArray(operation['tags']) ? operation['tags'] : [];
  const firstTag = tags.find((t): t is string => typeof t === 'string');
  const summary = asString(operation['summary']);
  const description = asString(operation['description']);
  const deprecated = asBoolean(operation['deprecated']);

  return {
    id,
    method,
    path,
    tag: firstTag ?? 'default',
    ...(summary ? { summary } : {}),
    ...(description ? { description } : {}),
    ...(deprecated ? { deprecated } : {}),
    parameters,
    ...(requestBody ? { requestBody } : {}),
    responses,
    isPaginated,
  };
}

/**
 * Parse an OpenAPI 3.x document into a normalized {@link SchemaAST}.
 *
 * @throws {SchemaParseError} If the document is Swagger 2.x or does not declare
 *   a supported `openapi: 3.x` version.
 */
export function parseOpenApi(doc: unknown): SchemaAST {
  if (!isRecord(doc)) {
    throw new SchemaParseError({ message: 'OpenAPI document must be an object.' });
  }

  if ('swagger' in doc) {
    const version = asString(doc['swagger']) ?? String(doc['swagger']);
    throw new SchemaParseError({
      message: `Swagger 2.x documents (swagger: ${version}) are not supported. Convert the spec to OpenAPI 3.x first — e.g. with the swagger2openapi tool or the editor.swagger.io "Convert to OpenAPI 3" action.`,
      code: 'UNSUPPORTED_SWAGGER_2',
    });
  }

  const openapiVersion = asString(doc['openapi']);
  if (openapiVersion === undefined || !openapiVersion.startsWith('3.')) {
    throw new SchemaParseError({
      message: `Expected an OpenAPI 3.x document but found openapi: ${
        openapiVersion ?? 'undefined'
      }.`,
      code: 'UNSUPPORTED_OPENAPI_VERSION',
    });
  }

  const infoRaw = asRecord(doc['info']);
  const info = {
    title: (infoRaw && asString(infoRaw['title'])) ?? 'API',
    version: (infoRaw && asString(infoRaw['version'])) ?? '0.0.0',
  };

  // Component schemas.
  const components: Record<string, TypeNode> = {};
  const schemasRaw = asRecord(asRecord(doc['components'])?.['schemas']);
  if (schemasRaw !== undefined) {
    for (const [name, value] of Object.entries(schemasRaw)) {
      components[name] = convertSchema(value);
    }
  }
  const circularRefs = detectCircularRefs(components);

  // Operations, paths, tags.
  const operations: OperationMap = {};
  const paths: PathMap = {};
  const tags: TagMap = {};
  const usedIds = new Set<string>();

  const pathsRaw = asRecord(doc['paths']);
  if (pathsRaw !== undefined) {
    for (const [path, pathItemValue] of Object.entries(pathsRaw)) {
      const pathItem = asRecord(pathItemValue);
      if (pathItem === undefined) continue;
      const inheritedParams = Array.isArray(pathItem['parameters']) ? pathItem['parameters'] : [];

      for (const [verb, httpMethod] of METHODS) {
        const operationRaw = asRecord(pathItem[verb]);
        if (operationRaw === undefined) continue;

        const op = parseOperation(doc, path, httpMethod, operationRaw, inheritedParams, usedIds);
        operations[op.id] = op;

        const pathEntry = paths[path] ?? {};
        pathEntry[httpMethod] = op.id;
        paths[path] = pathEntry;

        const tagEntry = tags[op.tag] ?? [];
        tagEntry.push(op.id);
        tags[op.tag] = tagEntry;
      }
    }
  }

  return {
    openapiVersion,
    info,
    components,
    operations,
    paths,
    tags,
    circularRefs,
  };
}
