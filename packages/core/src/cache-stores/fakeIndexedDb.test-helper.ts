/**
 * Minimal in-memory `IDBFactory` shim covering exactly what
 * `createIndexedDbStore` uses: open/onupgradeneeded (object store + one
 * index), get/put/delete/clear/count, and an index cursor supporting
 * `continue()`/`delete()`. Not spec-complete — just enough to exercise the
 * store's logic without a real browser or a `fake-indexeddb` dependency.
 */

class FakeRequest<T> {
  result: T = undefined as unknown as T;
  error: unknown;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;

  succeed(result: T): void {
    this.result = result;
    queueMicrotask(() => this.onsuccess?.());
  }

  fail(error: unknown): void {
    this.error = error;
    queueMicrotask(() => this.onerror?.());
  }
}

interface Row {
  key: string;
  value: unknown;
}

class FakeCursor {
  constructor(
    private rows: Row[],
    private index: number,
    private onDelete: (key: string) => void,
    private request: FakeRequest<FakeCursor | null>,
  ) {}

  delete(): void {
    const row = this.rows[this.index];
    if (row) this.onDelete(row.key);
  }

  continue(): void {
    this.index += 1;
    deliverCursor(this.rows, this.index, this.onDelete, this.request);
  }
}

function deliverCursor(
  rows: Row[],
  index: number,
  onDelete: (key: string) => void,
  request: FakeRequest<FakeCursor | null>,
): void {
  if (index >= rows.length) {
    request.succeed(null);
    return;
  }
  request.succeed(new FakeCursor(rows, index, onDelete, request));
}

class FakeIndex {
  constructor(
    private store: FakeObjectStore,
    private sortKey: string,
  ) {}

  openCursor(): FakeRequest<FakeCursor | null> {
    const request = new FakeRequest<FakeCursor | null>();
    const rows = [...this.store.rows()].sort((a, b) => {
      const av = (a.value as Record<string, number>)[this.sortKey] ?? 0;
      const bv = (b.value as Record<string, number>)[this.sortKey] ?? 0;
      return av - bv;
    });
    deliverCursor(rows, 0, (key) => this.store.deleteSync(key), request);
    return request;
  }
}

export interface QuotaSimulator {
  shouldFail: boolean;
}

class FakeObjectStore {
  private map = new Map<string, unknown>();
  private indexes = new Map<string, string>();

  constructor(private quota?: QuotaSimulator) {}

  rows(): Row[] {
    return [...this.map.entries()].map(([key, value]) => ({ key, value }));
  }

  deleteSync(key: string): void {
    this.map.delete(key);
  }

  createIndex(name: string, keyPath: string): void {
    this.indexes.set(name, keyPath);
  }

  get indexNames(): { contains: (name: string) => boolean } {
    return { contains: (name: string) => this.indexes.has(name) };
  }

  index(name: string): FakeIndex {
    const keyPath = this.indexes.get(name);
    if (!keyPath) throw new Error(`no such index: ${name}`);
    return new FakeIndex(this, keyPath);
  }

  get(key: string): FakeRequest<unknown> {
    const request = new FakeRequest<unknown>();
    request.succeed(this.map.get(key));
    return request;
  }

  put(value: unknown, key: string): FakeRequest<string> {
    const request = new FakeRequest<string>();
    if (this.quota?.shouldFail) {
      const err = new Error('quota exceeded');
      (err as { name: string }).name = 'QuotaExceededError';
      request.fail(err);
      return request;
    }
    this.map.set(key, value);
    request.succeed(key);
    return request;
  }

  delete(key: string): FakeRequest<undefined> {
    const request = new FakeRequest<undefined>();
    this.map.delete(key);
    request.succeed(undefined);
    return request;
  }

  clear(): FakeRequest<undefined> {
    const request = new FakeRequest<undefined>();
    this.map.clear();
    request.succeed(undefined);
    return request;
  }

  count(): FakeRequest<number> {
    const request = new FakeRequest<number>();
    request.succeed(this.map.size);
    return request;
  }
}

class FakeTransaction {
  constructor(private store: FakeObjectStore) {}
  objectStore(_name: string): FakeObjectStore {
    return this.store;
  }
}

class FakeDatabase {
  objectStoreNames = { contains: (_name: string) => this.created };
  private created = false;
  readonly store: FakeObjectStore;

  constructor(quota?: QuotaSimulator) {
    this.store = new FakeObjectStore(quota);
  }

  createObjectStore(_name: string): FakeObjectStore {
    this.created = true;
    return this.store;
  }

  transaction(_name: string, _mode: string): FakeTransaction {
    return new FakeTransaction(this.store);
  }
}

/** Build a fake `IDBFactory`; `quota.shouldFail = true` simulates a QuotaExceededError on the next `put`. */
export function createFakeIndexedDb(quota?: QuotaSimulator): {
  factory: IDBFactory;
  db: FakeDatabase;
} {
  const db = new FakeDatabase(quota);

  const factory = {
    open(_name: string, _version?: number) {
      const request = new FakeRequest<FakeDatabase>() as unknown as {
        result: FakeDatabase;
        onupgradeneeded: (() => void) | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
        transaction?: { objectStore: (name: string) => FakeObjectStore };
      };
      request.result = db;
      request.transaction = {
        objectStore: (name: string) => db.transaction(name, 'versionchange').objectStore(name),
      };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  } as unknown as IDBFactory;

  return { factory, db };
}
