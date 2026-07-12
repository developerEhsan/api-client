import { describe, expect, it } from 'vitest'
import {
  createCancellationManager,
  isAbortError,
  linkSignals,
} from './cancellation'

describe('linkSignals', () => {
  it('aborts merged controller when one input aborts', () => {
    const a = new AbortController()
    const b = new AbortController()
    const merged = linkSignals(a.signal, b.signal)

    expect(merged.signal.aborted).toBe(false)
    b.abort()
    expect(merged.signal.aborted).toBe(true)
  })

  it('ignores undefined inputs and aborts immediately if an input is already aborted', () => {
    const a = new AbortController()
    a.abort()
    const merged = linkSignals(undefined, a.signal, undefined)
    expect(merged.signal.aborted).toBe(true)
  })

  it('propagates the abort reason', () => {
    const a = new AbortController()
    const merged = linkSignals(a.signal)
    const reason = new Error('boom')
    a.abort(reason)
    expect(merged.signal.reason).toBe(reason)
  })
})

describe('isAbortError', () => {
  it('detects DOMException with name AbortError', () => {
    const err = new DOMException('aborted', 'AbortError')
    expect(isAbortError(err)).toBe(true)
  })

  it('detects Error-like with name AbortError', () => {
    const err = Object.assign(new Error('x'), { name: 'AbortError' })
    expect(isAbortError(err)).toBe(true)
  })

  it('returns false for non-abort errors and non-objects', () => {
    expect(isAbortError(new Error('other'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
    expect(isAbortError(undefined)).toBe(false)
  })
})

describe('CancellationManager debounce-cancel (X3)', () => {
  it('second acquire for same key aborts the first when dedupeWindow>0', () => {
    const mgr = createCancellationManager({ dedupeWindow: 100 })
    const first = mgr.acquire('k')
    const second = mgr.acquire('k')

    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
    expect(mgr.activeKeys()).toBe(1)
  })

  it('does not abort prior acquire when dedupeWindow is 0', () => {
    const mgr = createCancellationManager()
    const first = mgr.acquire('k')
    const second = mgr.acquire('k')

    expect(first.signal.aborted).toBe(false)
    expect(second.signal.aborted).toBe(false)
  })

  it('merges an external signal (aborting external aborts acquired)', () => {
    const mgr = createCancellationManager()
    const external = new AbortController()
    const { signal } = mgr.acquire('k', external.signal)
    expect(signal.aborted).toBe(false)
    external.abort()
    expect(signal.aborted).toBe(true)
  })
})

describe('CancellationManager cancel & settle', () => {
  it('cancel aborts the live controller for a key', () => {
    const mgr = createCancellationManager()
    const { signal } = mgr.acquire('k')
    mgr.cancel('k')
    expect(signal.aborted).toBe(true)
    expect(mgr.activeKeys()).toBe(0)
  })

  it('cancel is a no-op for unknown keys', () => {
    const mgr = createCancellationManager()
    expect(() => mgr.cancel('nope')).not.toThrow()
  })

  it('settle removes tracking so later acquire does not abort a settled one', () => {
    const mgr = createCancellationManager({ dedupeWindow: 100 })
    const first = mgr.acquire('k')
    first.settle()
    expect(mgr.activeKeys()).toBe(0)

    const second = mgr.acquire('k')
    // first was already settled (removed), so it stays un-aborted
    expect(first.signal.aborted).toBe(false)
    expect(second.signal.aborted).toBe(false)
  })

  it('settle only removes the key when it still owns the live controller', () => {
    const mgr = createCancellationManager({ dedupeWindow: 100 })
    const first = mgr.acquire('k')
    const second = mgr.acquire('k')
    // first was superseded and aborted; settling it must not evict second
    first.settle()
    expect(mgr.activeKeys()).toBe(1)
    expect(second.signal.aborted).toBe(false)
  })
})
