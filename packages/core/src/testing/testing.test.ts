import { describe, expect, it } from 'vitest'
import { createMockClient } from './createMockClient'
import { createMockAdapter } from './mockAdapter'
import { ApiError } from '../errors/ApiError'
import type { ModuleContext } from '../types/module.types'

const mod = {
  auto: false as const,
  things: {
    methods: {
      get: async (ctx: ModuleContext, id: string) =>
        (await ctx.request({ method: 'GET', path: '/things/{id}', pathParams: { id } })).data,
    },
  },
}

type ThingsApi = { things: { get: (id: string) => Promise<unknown> } }

describe('createMockClient / MockAdapter', () => {
  it('serves registered responses and records calls', async () => {
    const { api, mock } = createMockClient({ modules: mod })
    mock.on('GET', '/things/1', { data: { id: '1', name: 'a' } })
    const result = await (api as unknown as ThingsApi).things.get('1')
    expect(result).toEqual({ id: '1', name: 'a' })
    expect(mock.callsTo('GET', '/things/1')).toHaveLength(1)
  })

  it('supports function responders and error statuses', async () => {
    const { api, mock } = createMockClient({ modules: mod })
    mock.on('GET', '/things/', (req) => ({ status: 404, data: { message: `missing ${req.url}` } }))
    await expect(
      (api as unknown as ThingsApi).things.get('9'),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('falls back to 404 when nothing matches', async () => {
    const mock = createMockAdapter()
    const res = await mock.send({ url: 'http://x/none', method: 'GET', headers: {} })
    expect(res.status).toBe(404)
  })
})
