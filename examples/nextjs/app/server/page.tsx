import { api } from '@/lib/api/api.config';
/**
 * Server Component — direct usage, NO bridge needed.
 *
 * On the server the real `api` is already safe: the request never touches the
 * browser, so the base URL and paths aren't exposed. Call it directly in a
 * Server Component / Route Handler / Server Action. The bridge (Server Action +
 * /api/rpc) exists only so CLIENT components can call the same API without
 * leaking those secrets.
 *
 * `force-dynamic` keeps this out of the static build (it fetches per request).
 */
import { ApiError } from '@developerehsan/api-client';

export const dynamic = 'force-dynamic';

export default async function ServerPage() {
  let body: string;
  try {
    const list = await api.products.listProducts({ limit: 5 });
    body = JSON.stringify(list.products.map((p) => p.title), null, 2);
  } catch (error) {
    body =
      error instanceof ApiError
        ? `ApiError ${error.status ?? ''}: ${error.message}`
        : String(error);
  }

  return (
    <main
      style={{ maxWidth: 680, margin: '40px auto', fontFamily: 'system-ui', padding: '0 16px' }}
    >
      <h1>
        Server Component — direct <code>api</code>
      </h1>
      <p style={{ color: '#666' }}>
        Fetched on the server with <code>await api.products.listProducts()</code>. No bridge, no
        client JS for this call.
      </p>
      <pre style={{ background: '#f4f4f4', padding: 12, borderRadius: 6, overflowX: 'auto' }}>
        {body}
      </pre>
    </main>
  );
}
