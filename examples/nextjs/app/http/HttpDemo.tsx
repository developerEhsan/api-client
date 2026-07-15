'use client';

import { apiHttp } from '@/lib/api/rpc-http-client';
import { ApiError } from '@developerehsan/api-client/browser';
/**
 * Generic HTTP-transport variant. Same client surface as the Server Action demo,
 * but every call is a `POST /api/rpc` (see `lib/api/rpc-http-client.ts` and
 * `app/api/rpc/route.ts`). This is the framework-agnostic path that also works
 * outside Next.js (TanStack Start, Remix, …). Network tab shows POST /api/rpc
 * with `{ module, method, args }` — still no backend URL or paths.
 */
import { useState } from 'react';

export function HttpDemo() {
  const [out, setOut] = useState('Click to call via POST /api/rpc.');

  async function run() {
    setOut('Loading…');
    try {
      const inventory = await apiHttp.store.getInventory();
      setOut(JSON.stringify(inventory, null, 2));
    } catch (error) {
      setOut(
        error instanceof ApiError
          ? `ApiError ${error.status ?? ''}: ${error.message}`
          : String(error),
      );
    }
  }

  return (
    <main
      style={{ maxWidth: 680, margin: '40px auto', fontFamily: 'system-ui', padding: '0 16px' }}
    >
      <h1>httpTransport variant</h1>
      <p style={{ color: '#666' }}>
        <code>apiHttp.store.getInventory()</code> → <code>POST /api/rpc</code>. Same bridge, no
        Server Action.
      </p>
      <button onClick={run}>Fetch inventory</button>
      <pre style={{ background: '#f4f4f4', padding: 12, borderRadius: 6, overflowX: 'auto' }}>
        {out}
      </pre>
    </main>
  );
}
