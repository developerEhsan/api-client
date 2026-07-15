#!/usr/bin/env node
// Enforces the SSR RPC bridge invariant: the shipped browser bundle must not
// leak any backend detail. Fails CI (non-zero exit) if a forbidden token is
// found in packages/core/dist/browser.js. See CLAUDE.md "Runtime-safety invariant".
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = resolve(here, '../packages/core/dist/browser.js');

let source;
try {
  source = readFileSync(bundlePath, 'utf8');
} catch {
  console.error(`✗ Could not read ${bundlePath}. Did you build @developerehsan/api-client first?`);
  process.exit(1);
}

// Tokens that must never appear in the browser bundle. `axios` would pull the
// backend HTTP client into the client; the others are backend-only concepts.
const forbidden = [
  { pattern: /\baxios\b/, label: 'axios (backend HTTP client)' },
  { pattern: /openapi\.json/, label: 'openapi.json reference' },
  { pattern: /createRpcHandler/, label: 'server-side RPC handler' },
];

const hits = forbidden.filter(({ pattern }) => pattern.test(source));

if (hits.length > 0) {
  console.error('✗ Forbidden tokens leaked into packages/core/dist/browser.js:');
  for (const { label } of hits) console.error(`   - ${label}`);
  console.error('\nThe browser bundle must contain no backend host/paths/openapi/axios.');
  process.exit(1);
}

console.log('✓ Browser bundle is clean — no backend detail leaked.');
