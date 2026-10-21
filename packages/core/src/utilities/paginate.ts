/**
 * Cursor-pagination driver (#43). Turns "call this again with the next cursor
 * until it stops returning one" into an `AsyncIterable`, so the cursor-threading
 * loop is written once rather than re-hand-rolled per endpoint.
 *
 * Transport-agnostic on purpose: it takes a function, so it works with a module
 * method, an RPC-bridge call, or a plain fetch.
 */

/** Cursor values a page can hand back. */
export type Cursor = string | number;

/** How to read a page: where the next cursor lives, and optionally its items. */
export interface PaginateOptions<Page, Item = unknown> {
  /**
   * Pull the cursor for the next page out of this one. Return `null`/
   * `undefined` (or an empty string) when there are no more pages.
   *
   * @example `nextCursor: (page) => page.nextCursor`
   */
  nextCursor: (page: Page) => Cursor | null | undefined;
  /**
   * Pull the items out of a page. Required only by {@link paginateItems}.
   * @example `items: (page) => page.data`
   */
  items?: (page: Page) => readonly Item[];
  /**
   * Stop after this many pages. A backstop against an endpoint that keeps
   * handing back cursors forever.
   * @default 10000
   */
  maxPages?: number;
  /** Abort between pages. Checked before each fetch, so no extra call is made. */
  signal?: AbortSignal;
}

const DEFAULT_MAX_PAGES = 10_000;

/**
 * Yield each page in turn, following the cursor until it runs out.
 *
 * @example
 * ```ts
 * for await (const page of paginate(
 *   (cursor) => api.flags.list({ query: { cursor, limit: 100 } }),
 *   { nextCursor: (p) => p.nextCursor },
 * )) {
 *   console.log(page.data.length)
 * }
 * ```
 */
export async function* paginate<Page>(
  fetchPage: (cursor?: Cursor) => Promise<Page>,
  options: PaginateOptions<Page>,
): AsyncGenerator<Page, void, undefined> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const seen = new Set<Cursor>();
  let cursor: Cursor | undefined;

  for (let page = 0; page < maxPages; page++) {
    if (options.signal?.aborted) return;

    const result = cursor === undefined ? await fetchPage() : await fetchPage(cursor);
    yield result;

    const next = options.nextCursor(result);
    if (next === null || next === undefined || next === '') return;
    // A server that echoes the same cursor back would otherwise spin forever
    // against a live endpoint. Stop instead, and let maxPages stay a backstop
    // for the genuinely-advancing-but-endless case.
    if (seen.has(next)) return;
    seen.add(next);
    cursor = next;
  }
}

/**
 * Flatten {@link paginate} into a stream of individual items. Requires
 * `options.items`.
 *
 * @example
 * ```ts
 * for await (const flag of paginateItems(
 *   (cursor) => api.flags.list({ query: { cursor } }),
 *   { nextCursor: (p) => p.nextCursor, items: (p) => p.data },
 * )) {
 *   console.log(flag.key)
 * }
 * ```
 */
export async function* paginateItems<Page, Item>(
  fetchPage: (cursor?: Cursor) => Promise<Page>,
  options: PaginateOptions<Page, Item> & { items: (page: Page) => readonly Item[] },
): AsyncGenerator<Item, void, undefined> {
  for await (const page of paginate(fetchPage, options)) {
    yield* options.items(page);
  }
}

/**
 * Drain every page into one array. Convenience over {@link paginateItems} for
 * the "just give me all of them" case — it buys an unbounded array, so prefer
 * iterating when the result set can be large.
 *
 * @example
 * ```ts
 * const all = await collectPages(
 *   (cursor) => api.flags.list({ query: { cursor } }),
 *   { nextCursor: (p) => p.nextCursor, items: (p) => p.data },
 * )
 * ```
 */
export async function collectPages<Page, Item>(
  fetchPage: (cursor?: Cursor) => Promise<Page>,
  options: PaginateOptions<Page, Item> & { items: (page: Page) => readonly Item[] },
): Promise<Item[]> {
  const out: Item[] = [];
  for await (const item of paginateItems(fetchPage, options)) out.push(item);
  return out;
}
