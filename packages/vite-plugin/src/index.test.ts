/**
 * Vite plugin tests (C3): buildStart runs a one-shot generate; the plugin
 * no-ops cleanly when no config is resolvable.
 */
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apiClientCodegen } from './index';

const SPEC = {
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0.0' },
  paths: {
    '/pet/{petId}': {
      get: { operationId: 'getPetById', tags: ['pet'], responses: { '200': { description: 'ok' } } },
    },
  },
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'apiclient-vite-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false,
  );

describe('apiClientCodegen (vite plugin)', () => {
  it('exposes a named plugin with the expected hooks', () => {
    const plugin = apiClientCodegen({ input: 'x', output: 'y' });
    expect(plugin.name).toBe('@developerehsan/api-client-codegen');
    expect(typeof plugin.buildStart).toBe('function');
    expect(typeof plugin.configureServer).toBe('function');
  });

  it('buildStart generates from the resolved config', async () => {
    const input = join(dir, 'openapi.json');
    const output = join(dir, 'generated');
    await writeFile(input, JSON.stringify(SPEC));

    const plugin = apiClientCodegen({ input, output });
    await plugin.buildStart?.();

    expect(await exists(join(output, 'api.types.ts'))).toBe(true);
    expect(await exists(join(output, 'api.modules.ts'))).toBe(true);
  });

  it('no-ops when no input/output can be resolved', async () => {
    const plugin = apiClientCodegen({ input: '', output: '' });
    await expect(plugin.buildStart?.()).resolves.toBeUndefined();
  });
});
