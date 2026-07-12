import { describe, expect, it, vi } from 'vitest'
import { parseOpenApi } from '../codegen/parser'
import { validateValue, validateResponseBody } from '../codegen/schemaValidator'
import { diffSchemas, handleDrift, hasDrift } from './driftDetector'
import { createSchemaCache } from './schemaCache'
import { createSchemaLoader } from './schemaLoader'
import { SchemaError } from '../errors/SchemaError'
import type { SchemaAST, TypeNode } from '../types/openapi.types'

const doc = {
  openapi: '3.0.0',
  info: { title: 'T', version: '1' },
  paths: {
    '/invoices/{id}': {
      get: {
        operationId: 'getInvoice',
        tags: ['invoices'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Invoice' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Invoice: {
        type: 'object',
        required: ['id', 'amount'],
        properties: {
          id: { type: 'string' },
          amount: { type: 'number' },
          status: { type: 'string', enum: ['draft', 'paid'] },
        },
      },
    },
  },
}

const ast: SchemaAST = parseOpenApi(doc)

describe('validateValue', () => {
  const invoiceRef: TypeNode = { kind: 'ref', name: 'Invoice' }

  it('accepts a well-formed object', () => {
    expect(validateValue({ id: 'a', amount: 5 }, invoiceRef, ast).valid).toBe(true)
  })
  it('rejects a wrong primitive type', () => {
    const r = validateValue({ id: 'a', amount: 'nope' }, invoiceRef, ast)
    expect(r.valid).toBe(false)
    expect(r.errors[0]).toContain('amount')
  })
  it('rejects a missing required property', () => {
    expect(validateValue({ id: 'a' }, invoiceRef, ast).valid).toBe(false)
  })
  it('enforces enums', () => {
    expect(validateValue({ id: 'a', amount: 1, status: 'x' }, invoiceRef, ast).valid).toBe(false)
    expect(validateValue({ id: 'a', amount: 1, status: 'paid' }, invoiceRef, ast).valid).toBe(true)
  })
  it('validates a response body by path+method+status', () => {
    expect(validateResponseBody(ast, '/invoices/{id}', 'GET', 200, { id: 'a', amount: 5 }).valid).toBe(true)
    expect(validateResponseBody(ast, '/invoices/{id}', 'GET', 200, { id: 'a' }).valid).toBe(false)
    // Unknown path -> nothing to validate against -> valid.
    expect(validateResponseBody(ast, '/nope', 'GET', 200, {}).valid).toBe(true)
  })
})

describe('driftDetector', () => {
  it('detects added/removed operations and hash change', () => {
    const docB = JSON.parse(JSON.stringify(doc)) as typeof doc
    ;(docB.paths as Record<string, unknown>)['/new'] = {
      get: { operationId: 'newOp', tags: ['x'], responses: { '200': { description: 'ok' } } },
    }
    const diff = diffSchemas(ast, parseOpenApi(docB))
    expect(diff.addedOperations).toContain('newOp')
    expect(diff.hashChanged).toBe(true)
    expect(hasDrift(diff)).toBe(true)
  })
  it('reports no drift for identical schemas', () => {
    expect(hasDrift(diffSchemas(ast, parseOpenApi(doc)))).toBe(false)
  })
  it('throws in strict mode, warns in loose mode', () => {
    const docB = JSON.parse(JSON.stringify(doc)) as typeof doc
    delete (docB.paths as Record<string, unknown>)['/invoices/{id}']
    const diff = diffSchemas(ast, parseOpenApi(docB))
    expect(() => handleDrift(diff, { mode: 'strict' })).toThrow(SchemaError)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    handleDrift(diff, { mode: 'loose' })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('schemaLoader', () => {
  it('caches on success and falls back to last-good on failure (S6)', async () => {
    const cache = createSchemaCache()
    let calls = 0
    const loader = createSchemaLoader({
      cache,
      fetchJson: () => {
        calls += 1
        if (calls === 1) return Promise.resolve(doc)
        return Promise.reject(new Error('down'))
      },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const first = await loader.load('u')
    const second = await loader.load('u')
    expect(first.info.title).toBe('T')
    expect(second.info.title).toBe('T') // fell back
    expect(cache.get()).toBeDefined()
    warn.mockRestore()
  })
  it('throws when the first load fails with no cached schema', async () => {
    const loader = createSchemaLoader({
      cache: createSchemaCache(),
      fetchJson: () => Promise.reject(new Error('down')),
    })
    await expect(loader.load('u')).rejects.toBeInstanceOf(SchemaError)
  })
})
