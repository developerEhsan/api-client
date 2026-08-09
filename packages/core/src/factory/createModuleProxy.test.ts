/**
 * `serverOnly` module guard (spec 06): checked once per module, at
 * construction, not per call.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '../errors/ConfigurationError';
import { createMockClient } from '../testing/createMockClient';
import type { ModuleContext } from '../types/module.types';
import { defineModule } from './createModule';

function buildClient(serverOnly: boolean) {
  return createMockClient({
    modules: {
      auto: false as const,
      secrets: defineModule({
        serverOnly,
        methods: {
          read: async (_ctx: ModuleContext) => 'top-secret',
        },
      }),
      things: defineModule({
        methods: {
          get: async (ctx: ModuleContext) =>
            (await ctx.request({ method: 'GET', path: '/things' })).data,
        },
      }),
    },
  });
}

describe('ModuleDefinition.serverOnly', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a serverOnly module throws at construction in a simulated browser context', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    expect(() => buildClient(true)).toThrow(ConfigurationError);
  });

  it('a normal (non-serverOnly) module is unaffected by a browser context', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    expect(() => buildClient(false)).not.toThrow();
  });

  it('a serverOnly module is unaffected outside a browser context', async () => {
    const { api } = buildClient(true);
    const typedApi = api as unknown as { secrets: { read: () => Promise<string> } };
    await expect(typedApi.secrets.read()).resolves.toBe('top-secret');
  });
});
