/**
 * Custom cache-key composition (spec 10): `cacheKeyParts` adds dimensions
 * on top of the built-in tenant/auth scoping, safer than a full `keyResolver`
 * override for the common "add one more thing to the scope" case — e.g. an
 * admin viewing "as" a target user, or a multi-workspace dashboard.
 */
import { describe, expect, it, vi } from 'vitest';
import { createMockAdapter } from '../testing/mockAdapter';
import type { ModuleContext, ModuleRequestSpec } from '../types/module.types';
import { createClient } from './createClient';
import { createModuleProxy, type RequestRunner } from './createModuleProxy';

type DashboardApi = {
  dashboard: { getSummary: (workspaceId: string) => Promise<unknown> };
};

describe('cacheKeyParts (spec 10)', () => {
  it('two calls to the same URL with different cacheKeyParts produce independent cache entries', async () => {
    const mock = createMockAdapter();
    mock.on('GET', '/dashboard/summary', { data: { sales: 1 } });

    const api = createClient({
      baseURL: 'http://mock.test',
      openapi: { mode: 'runtime' },
      http: { adapter: mock, retry: { attempts: 1, baseDelay: 0, maxDelay: 0, jitter: false } },
      modules: {
        auto: false as const,
        dashboard: {
          methods: {
            getSummary: async (ctx: ModuleContext, workspaceId: string) =>
              (
                await ctx.request(
                  { method: 'GET', path: '/dashboard/summary' },
                  { cache: { cacheKeyParts: { workspaceId } } },
                )
              ).data,
          },
        },
      },
    }) as unknown as DashboardApi;

    await api.dashboard.getSummary('workspace-a');
    await api.dashboard.getSummary('workspace-a');
    expect(mock.callsTo('GET', '/dashboard/summary')).toHaveLength(1); // second call served from cache

    await api.dashboard.getSummary('workspace-b');
    expect(mock.callsTo('GET', '/dashboard/summary')).toHaveLength(2); // different workspace -> different entry
  });

  it('AutoMethodDescriptor.cacheKeyParts(args) resolves eagerly into spec.cacheKeyParts', async () => {
    const run = vi.fn((_spec: ModuleRequestSpec, ..._rest: unknown[]) =>
      Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {} }),
    );
    const proxy = createModuleProxy(
      {
        moduleName: 'dashboard',
        autoDescriptors: {
          getSummary: {
            method: 'GET',
            path: '/dashboard/summary',
            cacheKeyParts: (args) => ({ workspaceId: String(args?.query?.workspaceId ?? '') }),
          },
        },
        safeMode: false,
      },
      run as unknown as RequestRunner,
    ) as unknown as { getSummary: (args: { query: { workspaceId: string } }) => Promise<unknown> };

    await proxy.getSummary({ query: { workspaceId: 'w1' } });

    const spec = run.mock.calls[0]?.[0];
    if (!spec) throw new Error('run was not called');
    expect(spec.cacheKeyParts).toEqual({ workspaceId: 'w1' });
    expect(spec.cacheKeyPartsFailed).toBeUndefined();
  });

  it('AutoMethodDescriptor.cacheKeyParts(args) throwing sets cacheKeyPartsFailed (fail closed)', async () => {
    const run = vi.fn((_spec: ModuleRequestSpec, ..._rest: unknown[]) =>
      Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {} }),
    );
    const proxy = createModuleProxy(
      {
        moduleName: 'dashboard',
        autoDescriptors: {
          getSummary: {
            method: 'GET',
            path: '/dashboard/summary',
            cacheKeyParts: () => {
              throw new Error('boom');
            },
          },
        },
        safeMode: false,
      },
      run as unknown as RequestRunner,
    ) as unknown as { getSummary: () => Promise<unknown> };

    await proxy.getSummary();

    const spec = run.mock.calls[0]?.[0];
    if (!spec) throw new Error('run was not called');
    expect(spec.cacheKeyPartsFailed).toBe(true);
    expect(spec.cacheKeyParts).toBeUndefined();
  });

  it('a keyResolver still works unchanged when cacheKeyParts is not also set', async () => {
    const mock = createMockAdapter();
    mock.on('GET', '/dashboard/summary', { data: { sales: 1 } });

    const api = createClient({
      baseURL: 'http://mock.test',
      openapi: { mode: 'runtime' },
      http: { adapter: mock, retry: { attempts: 1, baseDelay: 0, maxDelay: 0, jitter: false } },
      cache: { keyResolver: (req) => `custom:${req.method}:${req.url}` },
      modules: {
        auto: false as const,
        dashboard: {
          methods: {
            getSummary: async (ctx: ModuleContext) =>
              (await ctx.request({ method: 'GET', path: '/dashboard/summary' })).data,
          },
        },
      },
    }) as unknown as { dashboard: { getSummary: () => Promise<unknown> } };

    await api.dashboard.getSummary();
    await api.dashboard.getSummary();
    expect(mock.callsTo('GET', '/dashboard/summary')).toHaveLength(1);
  });

  it('cacheKeyParts folds onto a keyResolver-produced key too', async () => {
    const mock = createMockAdapter();
    mock.on('GET', '/dashboard/summary', { data: { sales: 1 } });

    const api = createClient({
      baseURL: 'http://mock.test',
      openapi: { mode: 'runtime' },
      http: { adapter: mock, retry: { attempts: 1, baseDelay: 0, maxDelay: 0, jitter: false } },
      cache: { keyResolver: (req) => `custom:${req.method}:${req.url}` },
      modules: {
        auto: false as const,
        dashboard: {
          methods: {
            getSummary: async (ctx: ModuleContext, workspaceId: string) =>
              (
                await ctx.request(
                  { method: 'GET', path: '/dashboard/summary' },
                  { cache: { cacheKeyParts: { workspaceId } } },
                )
              ).data,
          },
        },
      },
    }) as unknown as DashboardApi;

    await api.dashboard.getSummary('workspace-a');
    await api.dashboard.getSummary('workspace-b');
    expect(mock.callsTo('GET', '/dashboard/summary')).toHaveLength(2);
  });
});
