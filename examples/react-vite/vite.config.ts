import { apiClientCodegen } from '@developerehsan/api-client-vite';
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { type Plugin, defineConfig } from 'vite';

/**
 * A tiny dev-server-only streaming backend for `src/features/StreamingDemo.tsx`
 * (see docs/streaming.md). DummyJSON has no SSE/NDJSON endpoint, so this
 * middleware serves both locally, over the same dev server, with real delays
 * between chunks — no external network dependency required to try the demo.
 */
function localStreamingBackend(): Plugin {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    name: 'local-streaming-backend',
    configureServer(server) {
      server.middlewares.use('/__stream/ndjson', async (_req, res) => {
        res.setHeader('Content-Type', 'application/x-ndjson');
        for (let i = 1; i <= 5; i++) {
          await delay(400);
          res.write(`${JSON.stringify({ seq: i, at: Date.now() })}\n`);
        }
        res.end();
      });
      server.middlewares.use('/__stream/sse', async (_req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        for (let i = 1; i <= 5; i++) {
          await delay(400);
          res.write(`event: tick\ndata: ${JSON.stringify({ seq: i, at: Date.now() })}\n\n`);
        }
        res.end();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // Auto-generate the typed client from the OpenAPI spec: a one-shot generate
    // on `vite build`, and a watcher during `vite dev` that regenerates
    // ./src/lib/api/types/generated whenever openapi.json changes.
    apiClientCodegen({
      input: './src/lib/api/openapi.json',
      output: './src/lib/api/types/generated',
      baseURL: 'https://dummyjson.com',
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    localStreamingBackend(),
  ],
});
