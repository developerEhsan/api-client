'use client';

import { q } from '@/lib/api/query';
import { api } from '@/lib/api/rpc-client';
import type { Pet } from '@/lib/api/types/generated/api.types';
import { ApiError } from '@developerehsan/api-client/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
/**
 * The whole point of this demo: this is a CLIENT component, yet every
 * `api.*.*()` call exposes nothing about the backend. Open the browser network
 * tab — you'll see only a POST to THIS origin carrying `{ module, method, args }`.
 * No `petstore3.swagger.io`, no `/pet/{petId}`, no openapi.json — those live
 * only on the server, behind the RPC handler.
 *
 * Scenarios covered here:
 *   1. Direct read           — api.pet.getPetById (note: `category` is redacted
 *                              server-side via transformResult).
 *   2. Direct write + authz  — api.pet.addPet is gated by an "editor" cookie
 *                              (the handler's `authorize` hook). Toggle it below.
 *   3. Cancellation          — an AbortSignal cancels a call locally.
 *   4. Uniform denial        — calling a NON-exposed method returns the same
 *                              generic error as an unknown one (no enumeration).
 *   5. TanStack Query        — useQuery through the bridge.
 *   6. TanStack Mutation     — useMutation + cache invalidation.
 */
import { useState } from 'react';

const box: React.CSSProperties = {
  background: '#f4f4f4',
  padding: 12,
  borderRadius: 6,
  overflowX: 'auto',
  fontSize: 13,
};
const section: React.CSSProperties = {
  marginTop: 28,
  paddingTop: 16,
  borderTop: '1px solid #e5e5e5',
};

/** Render any thrown value; `instanceof ApiError` still works after rehydration. */
function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return `ApiError ${error.status ?? ''} [${error.code ?? '?'}]: ${error.message}`;
  }
  return String(error);
}

export function PetDemo() {
  const queryClient = useQueryClient();
  const [petId, setPetId] = useState(1);
  const [status, setStatus] = useState<'available' | 'pending' | 'sold'>('sold');
  const [direct, setDirect] = useState('Click “Fetch pet” to call the bridge.');
  const [writeResult, setWriteResult] = useState('');
  const [isEditor, setIsEditor] = useState(
    () => typeof document !== 'undefined' && document.cookie.includes('demo_editor=1'),
  );

  // 5. TanStack Query, routed through the bridge via the paths-stripped descriptor.
  const byStatus = useQuery(q.pet.queryOptions.findPetsByStatus({ status }));

  // 6. TanStack Mutation → adds a pet, then invalidates the list query.
  const addMutation = useMutation(
    q.pet.mutationOptions.addPet({
      onSuccess: () => q.pet.invalidateQueries(queryClient),
    }),
  );

  // 1. Direct read (with cancellation support — scenario 3).
  async function fetchDirect() {
    setDirect('Loading…');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000); // auto-cancel after 8s
    try {
      const pet = await api.pet.getPetById({ petId }, { signal: controller.signal });
      // `category` will be absent — stripped by the handler's transformResult.
      setDirect(JSON.stringify(pet, null, 2));
    } catch (error) {
      setDirect(describeError(error));
    } finally {
      clearTimeout(timer);
    }
  }

  // 2. Direct write — denied unless the editor cookie is set.
  async function addDirect() {
    setWriteResult('Adding…');
    const body: Pet = { name: `Rex-${Date.now() % 1000}`, photoUrls: [], status: 'available' };
    try {
      const pet = await api.pet.addPet({ body });
      setWriteResult(`Added pet #${pet.id ?? '?'} (${pet.name}).`);
      void q.pet.invalidateQueries(queryClient);
    } catch (error) {
      setWriteResult(describeError(error));
    }
  }

  // 4. Uniform denial — `deletePet` exists on the client TYPE (the bridge mirrors
  // the whole API surface), but it is NOT in the server `expose` allowlist, so at
  // runtime it is denied with the same generic error as an unknown method.
  async function callForbidden() {
    try {
      await api.pet.deletePet({ petId });
      setDirect('(unexpected) call succeeded');
    } catch (error) {
      setDirect(`Denied as expected → ${describeError(error)}`);
    }
  }

  function toggleEditor() {
    const next = !isEditor;
    // Same-origin cookie → sent with both the Server Action and /api/rpc calls,
    // so the handler's `authorize` can read it. Not httpOnly here only because
    // the demo toggles it from JS; a real session cookie should be httpOnly.
    document.cookie = next
      ? 'demo_editor=1; path=/; SameSite=Lax'
      : 'demo_editor=; path=/; Max-Age=0; SameSite=Lax';
    setIsEditor(next);
  }

  return (
    <main
      style={{ maxWidth: 680, margin: '40px auto', fontFamily: 'system-ui', padding: '0 16px' }}
    >
      <h1>SSR RPC bridge</h1>
      <p style={{ color: '#666' }}>
        Client component → Server Action → real API. The backend URL and paths never reach the
        browser. Watch the Network tab: only <code>POST /</code>.
      </p>

      <section style={section}>
        <h2>
          1 · Direct read — <code>api.pet.getPetById</code>
        </h2>
        <label>
          petId:{' '}
          <input
            type="number"
            value={petId}
            onChange={(e) => setPetId(Number(e.target.value))}
            style={{ width: 80 }}
          />
        </label>{' '}
        <button onClick={fetchDirect}>Fetch pet</button>{' '}
        <button onClick={callForbidden}>Try forbidden (deletePet)</button>
        <p style={{ color: '#888', fontSize: 12 }}>
          The returned pet has no <code>category</code> — redacted by <code>transformResult</code>.
        </p>
        <pre style={box}>{direct}</pre>
      </section>

      <section style={section}>
        <h2>
          2 · Direct write + authorization — <code>api.pet.addPet</code>
        </h2>
        <p style={{ fontSize: 13 }}>
          Editor session: <strong>{isEditor ? 'ON' : 'OFF'}</strong>{' '}
          <button onClick={toggleEditor}>{isEditor ? 'Sign out' : 'Become editor'}</button>
        </p>
        <button onClick={addDirect}>Add a pet</button>
        <p style={{ color: '#888', fontSize: 12 }}>
          With editor OFF the <code>authorize</code> hook denies the write (uniform error). Turn it
          ON, then add.
        </p>
        <pre style={box}>{writeResult || '—'}</pre>
      </section>

      <section style={section}>
        <h2>
          5 · TanStack Query — <code>q.pet.queryOptions.findPetsByStatus</code>
        </h2>
        <label>
          status:{' '}
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="available">available</option>
            <option value="pending">pending</option>
            <option value="sold">sold</option>
          </select>
        </label>
        {byStatus.isPending && <p>Loading…</p>}
        {byStatus.isError && <p style={{ color: 'crimson' }}>{describeError(byStatus.error)}</p>}
        {byStatus.data && (
          <p>
            {byStatus.data.length} pets with status “{status}”.
          </p>
        )}
      </section>

      <section style={section}>
        <h2>
          6 · TanStack Mutation — <code>q.pet.mutationOptions.addPet</code>
        </h2>
        <button
          disabled={addMutation.isPending}
          onClick={() =>
            addMutation.mutate({
              body: { name: `Fido-${Date.now() % 1000}`, photoUrls: [], status: 'available' },
            })
          }
        >
          {addMutation.isPending ? 'Adding…' : 'Add via mutation (needs editor)'}
        </button>
        {addMutation.isError && (
          <p style={{ color: 'crimson' }}>{describeError(addMutation.error)}</p>
        )}
        {addMutation.isSuccess && <p>Added — list query invalidated & refetched.</p>}
      </section>

      <p style={{ ...section, color: '#888', fontSize: 13 }}>
        See <a href="/http">/http</a> for the generic <code>httpTransport</code> variant and{' '}
        <a href="/server">/server</a> for direct server-side usage (no bridge needed there).
      </p>
    </main>
  );
}
