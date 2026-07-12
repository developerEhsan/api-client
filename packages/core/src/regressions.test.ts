/**
 * Regression tests for bugs found in the Phase 7 adversarial review. Each test
 * name references the confirmed finding it locks in.
 */
import { describe, expect, it, vi } from 'vitest'
import { computeBackoff, withRetry, type ResolvedRetryOptions } from './utilities/retry'
import { createCancellationManager } from './utilities/cancellation'
import { deepMerge } from './factory/mergeModuleConfig'
import { parseOpenApi } from './codegen/parser'
import { validateValue } from './codegen/schemaValidator'
import { computeDedupeKey } from './utilities/deduplicator'
import type { SchemaAST, TypeNode } from './types/openapi.types'

const retryBase: ResolvedRetryOptions = {
  attempts: 3,
  backoff: 'exponential',
  baseDelay: 100,
  maxDelay: 5000,
  jitter: false,
}

describe('regressions', () => {
  it('[#11] Retry-After is capped by maxDelay', () => {
    // Server asks for 3600s; maxDelay is 5000ms — must not exceed the cap.
    expect(computeBackoff(1, retryBase, 3_600_000)).toBe(5000)
  })

  it('[#3] backoff sleep is interruptible by the abort signal', async () => {
    const ac = new AbortController()
    const fn = vi.fn().mockRejectedValue(
      Object.assign(new Error('boom'), { isRetryable: true, retryCount: 0 }),
    )
    // Abort exactly when the backoff is about to start; the (default) sleep
    // must reject with AbortError instead of waiting out the full 10s.
    const opts: ResolvedRetryOptions = {
      ...retryBase,
      baseDelay: 10_000,
      onRetry: () => ac.abort(),
    }
    const start = Date.now()
    await expect(withRetry(fn, opts, { signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it('[#12] dedupeWindow only cancels within the window', () => {
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1000)
    const mgr = createCancellationManager({ dedupeWindow: 50 })
    const first = mgr.acquire('k')
    // Second acquire 10s later — outside the 50ms window, must NOT abort first.
    nowSpy.mockReturnValue(11_000)
    mgr.acquire('k')
    expect(first.signal.aborted).toBe(false)
    // Within the window, it does abort.
    const third = mgr.acquire('j')
    nowSpy.mockReturnValue(11_020)
    mgr.acquire('j')
    expect(third.signal.aborted).toBe(true)
    nowSpy.mockRestore()
  })

  it('[#4] linkSignals listeners are cleaned up on settle (no leak)', () => {
    const external = new AbortController()
    const add = vi.spyOn(external.signal, 'addEventListener')
    const remove = vi.spyOn(external.signal, 'removeEventListener')
    const mgr = createCancellationManager({ dedupeWindow: 100 })
    const { settle } = mgr.acquire('k', external.signal)
    expect(add).toHaveBeenCalledTimes(1)
    settle()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('[#17] deepMerge ignores __proto__ (no prototype pollution)', () => {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>
    const result = deepMerge<Record<string, unknown>>({}, malicious)
    expect((result as { polluted?: unknown }).polluted).toBeUndefined()
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
  })

  it('[#6] parser honors OpenAPI 3.0 nullable', () => {
    const ast: SchemaAST = parseOpenApi({
      openapi: '3.0.0',
      info: { title: 't', version: '1' },
      paths: {},
      components: { schemas: { N: { type: 'string', nullable: true } } },
    })
    const node = ast.components['N']
    expect(node?.kind).toBe('union')
    // Valid string and null both pass; number fails.
    expect(validateValue('x', node as TypeNode, ast).valid).toBe(true)
    expect(validateValue(null, node as TypeNode, ast).valid).toBe(true)
    expect(validateValue(5, node as TypeNode, ast).valid).toBe(false)
  })

  it('[#14] validator enforces additionalProperties:false', () => {
    const type: TypeNode = {
      kind: 'object',
      properties: { id: { type: { kind: 'primitive', type: 'string' }, required: true } },
      additionalProperties: false,
    }
    const ast = { components: {} } as unknown as SchemaAST
    expect(validateValue({ id: 'a' }, type, ast).valid).toBe(true)
    expect(validateValue({ id: 'a', extra: 1 }, type, ast).valid).toBe(false)
  })

  it('[#2] dedup key includes the auth fingerprint', () => {
    const a = computeDedupeKey({ method: 'GET', url: '/me', authFingerprint: 'bearer:A' })
    const b = computeDedupeKey({ method: 'GET', url: '/me', authFingerprint: 'bearer:B' })
    expect(a).not.toBe(b)
  })

})
