import { apiClientCodegen } from '@developerehsan/api-client-vite';
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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
  ],
});
