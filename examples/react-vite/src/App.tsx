/**
 * @developerehsan/api-client — live demo (DummyJSON).
 *
 * Three sections:
 *   1. Direct typed client  — call `api.*` straight from components.
 *   2. TanStack Query       — the same client via useQuery/useInfiniteQuery/useMutation.
 *   3. Feature lab          — interactive cache/dedup/timeout/cancel/error/safeMode/ctx.run demos.
 *
 * The client is configured once in src/lib/api/api.config.ts against the free,
 * CORS-enabled https://dummyjson.com API.
 */
import { useState } from 'react';
import './App.css';
import { CachePersistenceDemo } from './features/CachePersistenceDemo';
import { ConcurrencyQueueDemo } from './features/ConcurrencyQueueDemo';
import { DirectClientDemo } from './features/DirectClientDemo';
import { FeatureLab } from './features/FeatureLab';
import { ManualTypesDemo } from './features/ManualTypesDemo';
import { MultiTenancyDemo } from './features/MultiTenancyDemo';
import { StreamingDemo } from './features/StreamingDemo';
import { TanstackDemo } from './features/TanstackDemo';
import { TimeoutsCancellationDemo } from './features/TimeoutsCancellationDemo';

type Tab =
  | 'direct'
  | 'tanstack'
  | 'lab'
  | 'queue'
  | 'tenancy'
  | 'streaming'
  | 'persistence'
  | 'timeouts'
  | 'manual-types';

const TABS: { id: Tab; label: string }[] = [
  { id: 'direct', label: '1 · Direct client' },
  { id: 'tanstack', label: '2 · TanStack Query' },
  { id: 'lab', label: '3 · Feature lab' },
  { id: 'queue', label: '4 · Concurrency queue' },
  { id: 'tenancy', label: '5 · Multi-tenancy' },
  { id: 'streaming', label: '6 · Streaming' },
  { id: 'persistence', label: '7 · Cache persistence' },
  { id: 'timeouts', label: '8 · Timeouts & cancellation' },
  { id: 'manual-types', label: '9 · Manual types' },
];

function App() {
  const [tab, setTab] = useState<Tab>('direct');

  return (
    <div className="app">
      <header className="app__header">
        <h1>@developerehsan/api-client</h1>
        <p>
          A typed, modular API client — live against{' '}
          <a href="https://dummyjson.com" target="_blank" rel="noreferrer">
            DummyJSON
          </a>
          . Open the console to watch the request pipeline (dev logging is on).
        </p>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab ${tab === t.id ? 'tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app__main">
        {tab === 'direct' ? <DirectClientDemo /> : null}
        {tab === 'tanstack' ? <TanstackDemo /> : null}
        {tab === 'lab' ? <FeatureLab /> : null}
        {tab === 'queue' ? <ConcurrencyQueueDemo /> : null}
        {tab === 'tenancy' ? <MultiTenancyDemo /> : null}
        {tab === 'streaming' ? <StreamingDemo /> : null}
        {tab === 'persistence' ? <CachePersistenceDemo /> : null}
        {tab === 'timeouts' ? <TimeoutsCancellationDemo /> : null}
        {tab === 'manual-types' ? <ManualTypesDemo /> : null}
      </main>

      <footer className="app__footer">
        Types &amp; modules generated from <code>openapi.json</code>; wired with{' '}
        <code>createTypedClient&lt;OperationsMap&gt;()(config, generatedModules)</code>.
      </footer>
    </div>
  );
}

export default App;
