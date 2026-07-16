import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Type-level regression gate. `*.test-d.ts` files assert compile-time
    // inference (autocomplete, override-wins, no `any` leaks) via `expectTypeOf`
    // and fail the run if a type regresses. Only diagnostics inside these files
    // are surfaced, so unrelated program errors don't break the suite.
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts'],
      tsconfig: './tsconfig.json',
    },
  },
});
