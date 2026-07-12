import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import App from "./App.tsx";

// One QueryClient for the app. The library's own dedup/cache cooperate with
// TanStack's — they don't fight.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } }, // the api client already retries
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
