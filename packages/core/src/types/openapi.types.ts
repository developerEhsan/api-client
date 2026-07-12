/**
 * Internal SchemaAST — the normalized intermediate representation the parser
 * produces from an OpenAPI 3.x document and the emitters consume.
 */

import type { HttpMethod } from './http.types'

/** A resolved type node in the schema AST. */
export type TypeNode =
  | { kind: 'primitive'; type: 'string' | 'number' | 'boolean' | 'null'; format?: string; enum?: readonly (string | number)[] }
  | { kind: 'array'; items: TypeNode }
  | { kind: 'object'; properties: Record<string, PropertyNode>; additionalProperties?: TypeNode | boolean }
  | { kind: 'union'; variants: TypeNode[] }
  | { kind: 'intersection'; parts: TypeNode[] }
  | { kind: 'ref'; name: string }
  | { kind: 'unknown'; reason?: string }

export interface PropertyNode {
  type: TypeNode
  required: boolean
  description?: string
  deprecated?: boolean
}

export interface ParameterNode {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required: boolean
  type: TypeNode
  description?: string
}

export interface OperationNode {
  /** operationId or a synthesized stable id. */
  id: string
  method: HttpMethod
  path: string
  tag: string
  summary?: string
  description?: string
  deprecated?: boolean
  parameters: ParameterNode[]
  requestBody?: { required: boolean; type: TypeNode }
  /** Map of status code -> response type. `default` is allowed as a key. */
  responses: Record<string, TypeNode>
  /** True when query params indicate pagination (page/limit/cursor/offset). */
  isPaginated: boolean
}

/** operationId -> operation. */
export type OperationMap = Record<string, OperationNode>

/** path template -> (method -> operationId). */
export type PathMap = Record<string, Partial<Record<HttpMethod, string>>>

/** tag name -> operationIds grouped under it. */
export type TagMap = Record<string, string[]>

export interface SchemaAST {
  openapiVersion: string
  info: { title: string; version: string }
  /** Named component schemas -> resolved type nodes. */
  components: Record<string, TypeNode>
  operations: OperationMap
  paths: PathMap
  tags: TagMap
  /** Names of schema nodes where a circular $ref was broken. */
  circularRefs: string[]
}

/** Field-level diff produced by the drift detector. */
export interface SchemaDiff {
  addedOperations: string[]
  removedOperations: string[]
  changedOperations: { id: string; reason: string }[]
  hashChanged: boolean
}
