/**
 * Type-level tests for path-param inference (B2) and the typed event map (B3).
 * Compile-only.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { ApiClient, ClientEventMap } from './createClient';
import type { TypedModuleContext } from './createTypedClient';
import type { ApiError } from '../errors/ApiError';
import type { ResolvedConfigSnapshot } from '../types/config.types';
import type { ApiResponse } from '../types/http.types';
import type { ExtractPathParams, PathParamsFor } from '../types/path.types';
import type { ModuleContext } from '../types/module.types';

describe('path-param inference (B2)', () => {
  it('extracts placeholder names from a path template', () => {
    expectTypeOf<ExtractPathParams<'/pet/{petId}/toys/{toyId}'>>().toEqualTypeOf<
      'petId' | 'toyId'
    >();
    expectTypeOf<ExtractPathParams<'/pets'>>().toEqualTypeOf<never>();
  });

  it('requires exactly the declared params, forbids extras/none', () => {
    expectTypeOf<PathParamsFor<'/pet/{petId}'>>().toEqualTypeOf<{
      pathParams: Record<'petId', string | number>;
    }>();
    // No placeholders -> pathParams optional & empty.
    expectTypeOf<PathParamsFor<'/pets'>>().toEqualTypeOf<{
      pathParams?: Record<string, never>;
    }>();
  });

  it('ctx.request enforces path params at the call site', () => {
    const ctx = undefined as unknown as ModuleContext;
    // Valid: matching param present.
    expectTypeOf(
      ctx.request<{ id: number }>({
        method: 'GET',
        path: '/pet/{petId}',
        pathParams: { petId: 1 },
      }),
    ).resolves.toEqualTypeOf<ApiResponse<{ id: number }>>();

    // Missing required pathParams is a type error.
    // @ts-expect-error - path declares {petId} but no pathParams supplied
    ctx.request({ method: 'GET', path: '/pet/{petId}' });

    // @ts-expect-error - wrong param name
    ctx.request({ method: 'GET', path: '/pet/{petId}', pathParams: { wrong: 1 } });

    // Placeholder-free path: pathParams omitted is fine.
    ctx.request({ method: 'GET', path: '/pets' });
  });
});

describe('typed event map (B3)', () => {
  const api = undefined as unknown as ApiClient;

  it('types built-in event payloads', () => {
    api.on('response', (p) => expectTypeOf(p).toEqualTypeOf<ApiResponse<unknown>>());
    api.on('error', (p) => expectTypeOf(p).toEqualTypeOf<ApiError>());
    api.on('settled', (p) =>
      expectTypeOf(p).toEqualTypeOf<{
        response: ApiResponse<unknown> | undefined;
        error: ApiError | undefined;
      }>(),
    );
    expectTypeOf<ClientEventMap['success']>().toEqualTypeOf<ApiResponse<unknown>>();
  });

  it('falls back to unknown for custom (ctx.emit) events', () => {
    api.on('module:notifications:new', (p) => expectTypeOf(p).toEqualTypeOf<unknown>());
  });
});

describe('enriched ModuleContext (D1/D2)', () => {
  const ctx = undefined as unknown as ModuleContext;

  it('ctx.run infers its result type from execute', () => {
    expectTypeOf(ctx.run('k', async () => 42)).resolves.toEqualTypeOf<number>();
    expectTypeOf(ctx.run('k', async () => ({ a: 1 }))).resolves.toEqualTypeOf<{ a: number }>();
  });

  it('ctx.run execute receives an optional AbortSignal', () => {
    ctx.run('k', async (signal) => {
      expectTypeOf(signal).toEqualTypeOf<AbortSignal | undefined>();
      return 1;
    });
  });

  it('ctx.emit / ctx.logger / ctx.config are typed', () => {
    expectTypeOf(ctx.emit).parameters.toEqualTypeOf<[string, unknown?]>();
    expectTypeOf(ctx.logger.warn).toEqualTypeOf<(...args: unknown[]) => void>();
    expectTypeOf(ctx.config()).toEqualTypeOf<ResolvedConfigSnapshot>();
  });

  it('the typed-client ctx (TypedModuleContext) also carries run/stream/emit/logger/config', () => {
    // Regression: the enriched ctx members must exist on the TYPED client too,
    // so config.modules methods can use ctx.run / ctx.stream / ctx.emit.
    type Ctx = TypedModuleContext<Record<string, never>, Record<string, never>>;
    expectTypeOf<Ctx>().toHaveProperty('run');
    expectTypeOf<Ctx>().toHaveProperty('stream');
    expectTypeOf<Ctx>().toHaveProperty('emit');
    expectTypeOf<Ctx>().toHaveProperty('logger');
    expectTypeOf<Ctx>().toHaveProperty('config');
  });
});
