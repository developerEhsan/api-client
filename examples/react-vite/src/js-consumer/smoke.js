// @ts-check
//
// Proof that a *plain JavaScript* consumer gets the same type safety as TS.
// This file has no type annotations — all IntelliSense and the errors below
// come purely from the package's shipped `.d.ts` declarations, checked here
// via `checkJs`. Run: `npx tsc -p tsconfig.jscheck.json`.

import { api } from '../lib/api/api.config';
import { q } from '../lib/api/query';

async function demo() {
  // Fully inferred: `product` is typed `Product`, so `.title` is a `string`.
  const product = await api.products.getProductById({ id: 1 });
  console.log(product.title.toUpperCase());

  // @ts-expect-error id must be a number — caught in JS too.
  await api.products.getProductById({ id: 'not-a-number' });

  // @ts-expect-error the client only exposes real endpoints — no typo methods.
  await api.products.thisMethodDoesNotExist();

  // A config-declared custom method is visible with its real return type.
  const summary = await api.analytics.summarize();
  console.log(summary.count, summary.avgPrice);

  // TanStack Query factories are typed for JS users as well.
  const opts = q.products.queryOptions.getProductById({ id: 1 });
  console.log(opts.queryKey);

  // Paginated GETs expose an infinite-query factory too.
  const infinite = q.products.infiniteQueryOptions.listProducts({ limit: 10 });
  console.log(infinite.queryKey);

  // @ts-expect-error addProduct is a POST → mutation only, not a query.
  void q.products.queryOptions.addProduct;
}

void demo;
