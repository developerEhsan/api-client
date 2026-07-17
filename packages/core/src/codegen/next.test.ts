/**
 * Next.js codegen integration test (C3): withApiClientCodegen runs a one-shot
 * generate on build and returns the config unchanged.
 */
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withApiClientCodegen } from './next';

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
  dir = await mkdtemp(join(tmpdir(), 'apiclient-next-'));
  // Reset the per-process "already started" guard so each test triggers codegen.
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for('developerehsan.api-client.codegen.next.started')
  ];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false,
  );

describe('withApiClientCodegen', () => {
  it('returns the provided nextConfig unchanged', () => {
    const cfg = { reactStrictMode: true };
    expect(withApiClientCodegen(cfg)).toBe(cfg);
  });

  it('runs a one-shot generate on a production build', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    const input = join(dir, 'openapi.json');
    const output = join(dir, 'generated');
    await writeFile(input, JSON.stringify(SPEC));

    withApiClientCodegen({}, { input, output });

    // Generation is a fire-and-forget side effect; poll for the output.
    await vi.waitFor(async () => expect(await exists(join(output, 'api.types.ts'))).toBe(true), {
      timeout: 2000,
    });
  });
});
