import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    node: 'src/index.ts',
    edge: 'src/edge.ts',
    codegen: 'src/codegen/index.ts',
    testing: 'src/testing/index.ts',
    server: 'src/server/index.ts',
    browser: 'src/browser/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  target: 'es2022',
  external: ['axios', 'zod'],
});
