/**
 * Global (per-process), in-memory tag -> cache-key index. Pure and IO-free.
 *
 * Lets a cache entry be filed under one or more logical tags, independent of
 * which auth scope owns the key, so a single tag invalidation reaches every
 * scoped copy of a resource in one pass. Only ever maps to opaque cache
 * *keys* — never exposes cached data across scopes; a tag lookup can only
 * be used to delete entries, never to read another scope's cached data.
 */

export interface TagIndex {
  /** Record that `key` is filed under `tags`. */
  track(key: string, tags: string[]): void;
  /** Stop tracking `key` (call on delete/evict so the index doesn't leak). */
  untrack(key: string): void;
  /** Return every key currently filed under any of `tags`. */
  keysFor(tags: string[]): Set<string>;
  clear(): void;
}

export function createTagIndex(): TagIndex {
  const tagToKeys = new Map<string, Set<string>>();
  const keyToTags = new Map<string, Set<string>>();

  return {
    track(key: string, tags: string[]): void {
      if (tags.length === 0) return;
      let existing = keyToTags.get(key);
      if (!existing) {
        existing = new Set<string>();
        keyToTags.set(key, existing);
      }
      for (const tag of tags) {
        existing.add(tag);
        let keys = tagToKeys.get(tag);
        if (!keys) {
          keys = new Set<string>();
          tagToKeys.set(tag, keys);
        }
        keys.add(key);
      }
    },

    untrack(key: string): void {
      const tags = keyToTags.get(key);
      if (!tags) return;
      for (const tag of tags) {
        const keys = tagToKeys.get(tag);
        if (!keys) continue;
        keys.delete(key);
        if (keys.size === 0) tagToKeys.delete(tag);
      }
      keyToTags.delete(key);
    },

    keysFor(tags: string[]): Set<string> {
      const out = new Set<string>();
      for (const tag of tags) {
        const keys = tagToKeys.get(tag);
        if (!keys) continue;
        for (const key of keys) out.add(key);
      }
      return out;
    },

    clear(): void {
      tagToKeys.clear();
      keyToTags.clear();
    },
  };
}
