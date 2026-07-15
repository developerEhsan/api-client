import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    react: 'src/react.ts',
    vue: 'src/vue.ts',
    solid: 'src/solid.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  external: [
    '@tanstack/react-query',
    '@tanstack/vue-query',
    '@tanstack/solid-query',
    '@developerehsan/api-client',
  ],
});
