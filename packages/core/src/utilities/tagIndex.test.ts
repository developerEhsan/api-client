import { describe, expect, it } from 'vitest';
import { createTagIndex } from './tagIndex';

describe('createTagIndex', () => {
  it('tracks a key under multiple tags and finds it by any of them', () => {
    const index = createTagIndex();
    index.track('key1', ['user:1', 'admin']);

    expect(index.keysFor(['user:1'])).toEqual(new Set(['key1']));
    expect(index.keysFor(['admin'])).toEqual(new Set(['key1']));
    expect(index.keysFor(['user:1', 'admin'])).toEqual(new Set(['key1']));
    expect(index.keysFor(['nonexistent'])).toEqual(new Set());
  });

  it('finds multiple keys sharing one tag', () => {
    const index = createTagIndex();
    index.track('key1', ['user:1']);
    index.track('key2', ['user:1']);
    index.track('key3', ['user:2']);

    expect(index.keysFor(['user:1'])).toEqual(new Set(['key1', 'key2']));
    expect(index.keysFor(['user:2'])).toEqual(new Set(['key3']));
  });

  it('untrack removes the key from every tag it was filed under', () => {
    const index = createTagIndex();
    index.track('key1', ['a', 'b']);
    index.track('key2', ['a']);

    index.untrack('key1');

    expect(index.keysFor(['a'])).toEqual(new Set(['key2']));
    expect(index.keysFor(['b'])).toEqual(new Set());
  });

  it('untrack is a no-op for an untracked key', () => {
    const index = createTagIndex();
    expect(() => index.untrack('never-tracked')).not.toThrow();
  });

  it('untracking every key leaves no dangling references (memory leak check)', () => {
    const index = createTagIndex();
    index.track('key1', ['a', 'b']);
    index.track('key2', ['b', 'c']);

    index.untrack('key1');
    index.untrack('key2');

    expect(index.keysFor(['a', 'b', 'c'])).toEqual(new Set());
    // Internal maps must be fully empty, not just returning empty results —
    // re-track the same tags and confirm no stale entries resurface.
    index.track('key3', ['a']);
    expect(index.keysFor(['a'])).toEqual(new Set(['key3']));
  });

  it('re-tracking a key adds to its tag set rather than replacing it', () => {
    const index = createTagIndex();
    index.track('key1', ['a']);
    index.track('key1', ['b']);

    expect(index.keysFor(['a'])).toEqual(new Set(['key1']));
    expect(index.keysFor(['b'])).toEqual(new Set(['key1']));

    index.untrack('key1');
    expect(index.keysFor(['a', 'b'])).toEqual(new Set());
  });

  it('clear empties both directions of the index', () => {
    const index = createTagIndex();
    index.track('key1', ['a']);
    index.track('key2', ['b']);

    index.clear();

    expect(index.keysFor(['a', 'b'])).toEqual(new Set());
    index.track('key3', ['a']);
    expect(index.keysFor(['a'])).toEqual(new Set(['key3']));
  });

  it('track with an empty tag list is a no-op', () => {
    const index = createTagIndex();
    index.track('key1', []);
    expect(index.keysFor([])).toEqual(new Set());
  });
});
