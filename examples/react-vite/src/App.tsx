/**
 * @developerEhsan/api-client — live demo (Swagger Petstore).
 *
 * Three sections:
 *   1. Direct typed client  — call `api.*` straight from components.
 *   2. TanStack Query       — the same client via useQuery/useMutation.
 *   3. Feature lab          — interactive cache/dedup/timeout/cancel/error/safeMode demos.
 *
 * The client is configured once in src/lib/api/api.config.ts.
 */
import { useState } from "react";
import "./App.css";
import { DirectClientDemo } from "./features/DirectClientDemo";
import { TanstackDemo } from "./features/TanstackDemo";
import { FeatureLab } from "./features/FeatureLab";

type Tab = "direct" | "tanstack" | "lab";

const TABS: { id: Tab; label: string }[] = [
  { id: "direct", label: "1 · Direct client" },
  { id: "tanstack", label: "2 · TanStack Query" },
  { id: "lab", label: "3 · Feature lab" },
];

function App() {
  const [tab, setTab] = useState<Tab>("direct");

  return (
    <div className="app">
      <header className="app__header">
        <h1>@developerEhsan/api-client</h1>
        <p>
          A typed, modular API client — live against the{" "}
          <a href="https://petstore3.swagger.io" target="_blank" rel="noreferrer">
            Swagger Petstore
          </a>
          . Open the console to watch the request pipeline (dev logging is on).
        </p>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab ${tab === t.id ? "tab--active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app__main">
        {tab === "direct" ? <DirectClientDemo /> : null}
        {tab === "tanstack" ? <TanstackDemo /> : null}
        {tab === "lab" ? <FeatureLab /> : null}
      </main>

      <footer className="app__footer">
        Types &amp; modules generated from <code>openapi.json</code>; wired with{" "}
        <code>createTypedClient&lt;OperationsMap&gt;()(config, generatedModules)</code>.
      </footer>
    </div>
  );
}

export default App;
