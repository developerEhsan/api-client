import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '../errors/ConfigurationError';
import { assertServerOnly } from './serverOnly';

describe('assertServerOnly', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws ConfigurationError when window + document are both present', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    expect(() => assertServerOnly('some-module')).toThrow(ConfigurationError);
    expect(() => assertServerOnly('some-module')).toThrow(/must not run in the browser/);
  });

  it('does not throw when only window is present (e.g. some worker globals)', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', undefined);
    expect(() => assertServerOnly('some-module')).not.toThrow();
  });

  it('does not throw when window/document are absent (Node/edge)', () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    expect(() => assertServerOnly('some-module')).not.toThrow();
  });

  it('the error message never echoes the caller-supplied "where" details beyond the label', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    try {
      assertServerOnly('createRpcHandler');
      throw new Error('expected assertServerOnly to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigurationError);
      expect((err as Error).message).not.toMatch(/https?:\/\//);
    }
  });
});
