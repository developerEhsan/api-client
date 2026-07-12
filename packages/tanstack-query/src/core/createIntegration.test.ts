import { describe, expect, it, vi } from 'vitest'
import { createQueryIntegration } from './createIntegration'
import type { ClientLike } from './types'

function setup() {
  const calls: Array<{ method: string; params: unknown; signal: boolean }> = []
  const make =
    (name: string) =>
    (params?: unknown, perCall?: { signal?: AbortSignal }): Promise<unknown> => {
      calls.push({ method: name, params, signal: !!perCall?.signal })
      return Promise.resolve({ ok: true, nextCursor: params && (params as Record<string, unknown>)['cursor'] === 'c1' ? null : 'c1' })
    }
  const client: ClientLike = {
    invoices: { list: make('list'), get: make('get'), create: make('create') },
  }
  const config = {
    modules: {
      invoices: {
        list: { method: 'GET', path: '/invoices', isPaginated: true },
        get: { method: 'GET', path: '/invoices/{id}' },
        create: { method: 'POST', path: '/invoices' },
      },
    },
  } as const
  const integration = createQueryIntegration(client, config)
  const invoices = integration.invoices
  if (!invoices) throw new Error('invoices module missing')
  return { calls, integration, invoices }
}

describe('createQueryIntegration', () => {
  it('builds hierarchical, serializable query keys', () => {
    const { invoices } = setup()
    expect(invoices.queryOptions.list!({ page: 1 }).queryKey).toEqual([
      'developerEhsan',
      'invoices',
      'list',
      { page: 1 },
    ])
    expect(invoices.keys.all).toEqual(['developerEhsan', 'invoices'])
  })

  it('executes queryFn through the client and forwards the abort signal', async () => {
    const { calls, invoices } = setup()
    const ac = new AbortController()
    await invoices.queryOptions.list!({ page: 1 }).queryFn({ signal: ac.signal })
    expect(calls.at(-1)).toMatchObject({ method: 'list', signal: true })
  })

  it('disables queries with missing required params (Q4)', () => {
    const { invoices } = setup()
    expect(invoices.queryOptions.get!().enabled).toBe(false) // path needs {id}
    expect(invoices.queryOptions.get!(null).enabled).toBe(false)
    expect(invoices.queryOptions.get!({ id: 1 }).enabled).toBe(true)
    expect(invoices.queryOptions.list!().enabled).toBe(true) // no path params
  })

  it('classifies write methods as mutations', async () => {
    const { calls, invoices } = setup()
    const opts = invoices.mutationOptions.create!()
    expect(opts.mutationKey).toEqual(['developerEhsan', 'invoices', 'create'])
    await opts.mutationFn({ amount: 10 })
    expect(calls.at(-1)).toMatchObject({ method: 'create', params: { amount: 10 } })
    // create is not exposed as a query option (write method → mutation only)
    expect((invoices.queryOptions as Record<string, unknown>)['create']).toBeUndefined()
  })

  it('generates infinite queries for paginated GETs and injects the page param', async () => {
    const { calls, invoices } = setup()
    const inf = invoices.infiniteQueryOptions.list!({ limit: 20 })
    expect(inf.initialPageParam).toBeUndefined()
    await inf.queryFn({ pageParam: 'c1' })
    expect(calls.at(-1)?.params).toMatchObject({ limit: 20, cursor: 'c1' })
    expect(inf.getNextPageParam({ nextCursor: 'c2' })).toBe('c2')
    expect(inf.getNextPageParam({ nextCursor: null })).toBeUndefined()
  })

  it('invalidates module- and method-level keys', async () => {
    const { invoices } = setup()
    const qc = { invalidateQueries: vi.fn().mockResolvedValue(undefined) }
    await invoices.invalidateQueries(qc)
    await invoices.invalidateQueries(qc, 'list')
    expect(qc.invalidateQueries).toHaveBeenNthCalledWith(1, { queryKey: ['developerEhsan', 'invoices'] })
    expect(qc.invalidateQueries).toHaveBeenNthCalledWith(2, { queryKey: ['developerEhsan', 'invoices', 'list'] })
  })
})
