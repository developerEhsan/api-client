// @ts-check
//
// Proof that a *plain JavaScript* consumer gets the same type safety as TS.
// This file has no type annotations — all IntelliSense and the errors below
// come purely from the package's shipped `.d.ts` declarations, checked here
// via `checkJs`. Run: `npx tsc -p tsconfig.jscheck.json`.

import { api } from '../lib/api/api.config';
import { q } from '../lib/api/query';

async function demo() {
  // Fully inferred: `pet` is typed `Pet`, so `.name` is a `string`.
  const pet = await api.pet.getPetById({ petId: 1 });
  console.log(pet.name.toUpperCase());

  // @ts-expect-error petId must be a number — caught in JS too.
  await api.pet.getPetById({ petId: 'not-a-number' });

  // @ts-expect-error the client only exposes real endpoints — no typo methods.
  await api.pet.thisMethodDoesNotExist();

  // The config-declared module is visible with its methods.
  const invoices = await api.invoices.getInvoices();
  console.log(invoices.data);

  // TanStack Query factories are typed for JS users as well.
  const opts = q.pet.queryOptions.findPetsByStatus({ status: 'available' });
  console.log(opts.queryKey);

  // @ts-expect-error placeOrder is a POST → mutation only, not a query.
  void q.store.queryOptions.placeOrder;
}

void demo;
