/**
 * MANUAL TYPES DEMO (no codegen)
 * ------------------------------
 * Docs: https://github.com/developerEhsan/api-client/blob/master/docs/manual-types.md
 *
 * `createTypedClient<Ops>()(config, descriptors)` doesn't require codegen —
 * `Ops` is a plain type parameter. Hand-write it in the same shape codegen's
 * `api.types.ts` would emit and you get identical end-to-end type-safety with
 * zero build step. `createModuleDefiner<Ops, Mods>()` on top gives
 * method-NAME autocomplete for brand-new modules too (here `Mods` is `{}`
 * since nothing is generated).
 */
import { createModuleDefiner, createTypedClient } from '@developerehsan/api-client';
import { useState } from 'react';
import { Button, Panel } from '../components/ui';

// 1. Hand-write the operations map — same 4-field shape codegen emits
//    (params/query/body/response), see docs/manual-types.md.
interface ManualOperations {
  getQuote: { response: { id: number; quote: string; author: string } };
  getTodo: { params: { id: number }; response: { id: number; todo: string; completed: boolean } };
}

// 2. Bind a definer to the hand-written Ops map — `{}` stands in for "no
//    generated modules" (there's no codegen output in this demo). NOTE: the
//    "known module" overload (real per-descriptor method-NAME autocomplete,
//    see docs/manual-types.md) requires binding `Mods` to an ACTUAL generated
//    module map, which this codegen-free demo deliberately has none of — a
//    hand-rolled descriptor map here does not typecheck against
//    `GeneratedMethodDescriptor` (verified against createTypedClient.ts's
//    `ModuleMethodHints`/`TypedRequest`), so this demo uses the *brand-new
//    module* overload instead (still autocompletes method names/inputs
//    against `ManualOperations` inside the method body).
// biome-ignore lint/complexity/noBannedTypes: {} is the documented "no generated modules" shape here
const defineModule = createModuleDefiner<ManualOperations, {}>();

// 3. Define a brand-new module — `defineModule('quotes', ...)`'s first
//    argument is type-level only (see createModuleDefiner's JSDoc); method
//    NAMES below (getQuote/getTodo) autocomplete against ManualOperations.
const quotes = defineModule('quotes', {
  methods: {
    // Custom module methods return whatever `ctx.request` resolves to (the
    // full response envelope), so `.data` must be extracted explicitly and
    // cast to the operation's typed response.
    getQuote: async (ctx) => {
      const res = await ctx.request({ method: 'GET', path: '/quotes/random' });
      return res.data as ManualOperations['getQuote']['response'];
    },
    getTodo: async (ctx, id: number) => {
      const res = await ctx.request({ method: 'GET', path: '/todos/{id}', pathParams: { id } });
      return res.data as ManualOperations['getTodo']['response'];
    },
  },
});

// 4. Full type-safety, zero codegen: `ManualOperations` drives both the
//    module's method inputs above and the resulting client's return types.
// A branded module (from `defineModule`) is wired via `config.modules`, NOT the
// second positional arg — that arg is reserved for generated method
// *descriptors* (raw `{ method, path, operationId }` shapes, see
// `docs/manual-types.md`'s worked example). There are none here, so it's `{}`.
const api = createTypedClient<ManualOperations>()(
  { baseURL: 'https://dummyjson.com', openapi: { mode: 'runtime' }, modules: { quotes } },
  {},
);

export function ManualTypesDemo() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const push = (line: string) => setLog((prev) => [...prev.slice(-20), line]);

  async function run() {
    setBusy(true);
    try {
      const quote = await api.quotes.getQuote(); // typed: { id, quote, author }
      push(`getQuote() → "${quote.quote}" — ${quote.author}`);
      const todo = await api.quotes.getTodo(1); // typed: { id, todo, completed }
      push(`getTodo(1) → "${todo.todo}" (completed: ${todo.completed})`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Manual types (no codegen)"
      subtitle="createTypedClient<Ops>() + createModuleDefiner — hand-written Ops, full type-safety, no build step."
    >
      <Button disabled={busy} onClick={run}>
        {busy ? 'Calling…' : 'Call quotes.getQuote() + quotes.getTodo(1)'}
      </Button>
      <pre style={{ marginTop: 12, maxHeight: 200, overflow: 'auto' }}>{log.join('\n')}</pre>
    </Panel>
  );
}
