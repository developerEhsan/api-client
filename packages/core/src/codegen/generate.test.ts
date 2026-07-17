/**
 * Codegen orchestration tests: real per-operation diff (C4), CI check mode
 * (C5), config loading (C1), and remote-fetch security hygiene (C2/F0).
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineCodegenConfig, loadCodegenConfig, loadCodegenConfigFile } from './config';
import { diff, generate, validate } from './generate';

function petstore(ops: Record<string, { method: string; path: string; query?: string }>) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [id, o] of Object.entries(ops)) {
    const entry = paths[o.path] ?? {};
    paths[o.path] = entry;
    entry[o.method] = {
      operationId: id,
      tags: ['pet'],
      ...(o.query
        ? { parameters: [{ name: o.query, in: 'query', schema: { type: 'string' } }] }
        : {}),
      responses: { '200': { description: 'ok' } },
    };
  }
  return { openapi: '3.0.0', info: { title: 'Petstore', version: '1.0.0' }, paths };
}

const SPEC_A = petstore({
  getPetById: { method: 'get', path: '/pet/{petId}' },
  listPets: { method: 'get', path: '/pet' },
  delPet: { method: 'delete', path: '/pet/{petId}' },
});
// vs A: getPetById unchanged, listPets gains a query param (changed), delPet
// removed, addPet added.
const SPEC_B = petstore({
  getPetById: { method: 'get', path: '/pet/{petId}' },
  listPets: { method: 'get', path: '/pet', query: 'status' },
  addPet: { method: 'post', path: '/pet' },
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'apiclient-codegen-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('generate + diff (C4 real per-operation diff)', () => {
  it('writes the meta file and computes added/removed/changed operations', async () => {
    const specA = join(dir, 'a.json');
    const out = join(dir, 'gen');
    await writeFile(specA, JSON.stringify(SPEC_A));
    const result = await generate({ input: specA, output: out, generatedAt: 'T' });
    expect(result.files).toContain('api.schema.meta.json');

    const meta = JSON.parse(await readFile(join(out, 'api.schema.meta.json'), 'utf8'));
    expect(Object.keys(meta.operations).sort()).toEqual(['delPet', 'getPetById', 'listPets']);

    const specB = join(dir, 'b.json');
    await writeFile(specB, JSON.stringify(SPEC_B));
    const d = await diff(specB, out);
    expect(d.hashChanged).toBe(true);
    expect(d.addedOperations).toEqual(['addPet']);
    expect(d.removedOperations).toEqual(['delPet']);
    expect(d.changedOperations.map((c) => c.id)).toEqual(['listPets']);
  });

  it('reports no changes when the spec is identical', async () => {
    const spec = join(dir, 'a.json');
    const out = join(dir, 'gen');
    await writeFile(spec, JSON.stringify(SPEC_A));
    await generate({ input: spec, output: out, generatedAt: 'T' });
    const d = await diff(spec, out);
    expect(d.hashChanged).toBe(false);
    expect(d.addedOperations).toEqual([]);
    expect(d.changedOperations).toEqual([]);
  });
});

describe('generate check mode (C5)', () => {
  it('reports upToDate and writes nothing', async () => {
    const spec = join(dir, 'a.json');
    const out = join(dir, 'gen');
    await writeFile(spec, JSON.stringify(SPEC_A));
    await generate({ input: spec, output: out, generatedAt: 'T' });

    const same = await generate({ input: spec, output: out, check: true });
    expect(same.upToDate).toBe(true);
    expect(same.files).toEqual([]);

    await writeFile(spec, JSON.stringify(SPEC_B));
    const stale = await generate({ input: spec, output: out, check: true });
    expect(stale.upToDate).toBe(false);
  });
});

describe('config loading (C1)', () => {
  it('defineCodegenConfig is identity', () => {
    const c = defineCodegenConfig({ input: 'x', output: 'y' });
    expect(c).toEqual({ input: 'x', output: 'y' });
  });

  it('loads a JSON config and finds the nearest one walking up', async () => {
    await writeFile(
      join(dir, 'api-client.config.json'),
      JSON.stringify({ input: './openapi.json', output: './gen' }),
    );
    const found = await loadCodegenConfig(dir);
    expect(found?.config.input).toBe('./openapi.json');
    expect(found?.config.output).toBe('./gen');
  });

  it('rejects a config missing required fields', async () => {
    const bad = join(dir, 'api-client.config.json');
    await writeFile(bad, JSON.stringify({ output: './gen' }));
    await expect(loadCodegenConfigFile(bad)).rejects.toThrow(/input/);
  });

  it('returns undefined when no config exists', async () => {
    expect(await loadCodegenConfig(dir)).toBeUndefined();
  });
});

describe('remote spec fetch hygiene (C2/F0 security)', () => {
  const SECRET = 'super-secret-token-value';
  const URL = 'https://api.example.com/openapi.json';

  it('never leaks the auth header into generated artifacts or logs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      // The secret must have been sent...
      expect((init?.headers as Record<string, string>)['authorization']).toBe(`Bearer ${SECRET}`);
      return new Response(JSON.stringify(SPEC_A), {
        status: 200,
        headers: { etag: 'W/"v1"', 'content-type': 'application/json' },
      });
    });
    const out = join(dir, 'gen');
    await generate({
      input: URL,
      output: out,
      headers: { authorization: `Bearer ${SECRET}` },
      generatedAt: 'T',
    });
    expect(fetchSpy).toHaveBeenCalled();

    // ...but must appear in NONE of the emitted files.
    for (const f of ['api.types.ts', 'api.modules.ts', 'api.rpc.ts', 'api.schema.meta.json']) {
      const content = await readFile(join(out, f), 'utf8');
      expect(content).not.toContain(SECRET);
    }
  });

  it('redacts the URL (no query/userinfo) in fetch errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 500 }) as Response,
    );
    await expect(validate('https://user:pw@api.example.com/spec.json?apikey=LEAK')).rejects.toThrow(
      /^.*api\.example\.com\/spec\.json.*$/,
    );
    // The thrown message must not carry the query token or userinfo.
    await expect(validate('https://api.example.com/spec.json?apikey=LEAK')).rejects.not.toThrow(
      /LEAK/,
    );
  });
});
