/**
 * Type-level regression tests for the config/hooks parity surface (A1–A3).
 * Compile-only; pins the public shape so refactors can't silently drop it.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  LifecycleHooks,
  ModuleConfig,
  PerCallConfig,
  ResolvedConfigSnapshot,
} from '../types/config.types';
import type { ApiClient } from './createClient';

describe('config & hooks types', () => {
  it('exposes onSuccess/onSettled on LifecycleHooks', () => {
    expectTypeOf<LifecycleHooks>().toHaveProperty('onSuccess');
    expectTypeOf<LifecycleHooks>().toHaveProperty('onSettled');
  });

  it('allows transforming hooks to return void (pass-through)', () => {
    const h: LifecycleHooks = { onRequest: () => undefined, onResponse: () => undefined };
    expectTypeOf(h.onRequest).parameter(0).toMatchTypeOf<{ url: string }>();
  });

  it('accepts hooks at the module and per-call layers', () => {
    expectTypeOf<ModuleConfig>()
      .toHaveProperty('hooks')
      .toEqualTypeOf<LifecycleHooks | undefined>();
    expectTypeOf<PerCallConfig>()
      .toHaveProperty('hooks')
      .toEqualTypeOf<LifecycleHooks | undefined>();
  });

  it('adds a per-call queue opt-out', () => {
    expectTypeOf<PerCallConfig>().toHaveProperty('queue').toEqualTypeOf<boolean | undefined>();
  });

  it('config.resolve returns a redacted snapshot with a hook presence map', () => {
    const resolve = (undefined as unknown as ApiClient)['config'].resolve;
    expectTypeOf(resolve).returns.toEqualTypeOf<ResolvedConfigSnapshot>();
    expectTypeOf<ResolvedConfigSnapshot['auth']>().toEqualTypeOf<{
      strategy: import('../types/auth.types').AuthConfig['strategy'];
    }>();
    expectTypeOf<ResolvedConfigSnapshot['hooks']>().toEqualTypeOf<
      Record<keyof LifecycleHooks, boolean>
    >();
  });
});
