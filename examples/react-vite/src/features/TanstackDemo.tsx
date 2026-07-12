/**
 * TANSTACK QUERY USAGE
 * --------------------
 * The same typed client, driven through React Query. `q.pet.queryOptions.*`
 * and `q.pet.mutationOptions.*` return ready-made option objects:
 *
 *   useQuery(q.pet.queryOptions.findPetsByStatus({ status }))
 *   useMutation(q.pet.mutationOptions.addPet({ onSuccess: ... }))
 *
 * Benefits over calling directly: React Query handles caching/refetch/loading
 * state and dedupes across components; the api client dedupes at the network
 * level and adds retries/timeouts. Query keys are stable so invalidation after
 * a mutation refetches the list automatically.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { q } from "../lib/api/query";
import type { Pet } from "../lib/api/types/generated/api.types";
import { Button, Panel, Spinner, StatusBadge } from "../components/ui";

type Status = "available" | "pending" | "sold";

export function TanstackDemo() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("available");
  const [name, setName] = useState("Rex the Demo Dog");

  // QUERY — typed params in, typed data out.
  const petsQuery = useQuery(q.pet.queryOptions.findPetsByStatus({ status }));

  // MUTATION — create a pet, then invalidate the list so it refetches.
  const addPet = useMutation(
    q.pet.mutationOptions. addPet({
      onSuccess: () => {
        // Invalidate every 'pet' query for this integration.
        void q.pet.invalidateQueries(queryClient);
      },
    }),
  );

  const pets = (petsQuery.data as Pet[] | undefined) ?? [];

  return (
    <Panel
      title="Browse & create pets (TanStack Query)"
      subtitle="useQuery + useMutation built from the same typed client. Creating a pet invalidates the list and refetches."
    >
      <div className="toolbar">
        <label>
          Status&nbsp;
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            <option value="available">available</option>
            <option value="pending">pending</option>
            <option value="sold">sold</option>
          </select>
        </label>
        {petsQuery.isFetching ? <Spinner /> : null}
        <span className="muted">{pets.length} pets</span>
      </div>

      <div className="toolbar">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New pet name"
        />
        <Button
          disabled={addPet.isPending}
          onClick={() =>
            // The mutation's variables are the operation input — here the `body`.
            addPet.mutate({
              body: { name, photoUrls: [], status: "available" },
            })
          }
        >
          {addPet.isPending ? "Adding…" : "Add pet (addPet)"}
        </Button>
        {addPet.isSuccess ? <span className="muted">created ✓ (list refetched)</span> : null}
      </div>

      {addPet.isError ? (
        <div className="alert">
          addPet failed: {String((addPet.error as Error).message)} (the public Petstore
          occasionally 500s on writes — the client retried, then surfaced a typed ApiError)
        </div>
      ) : null}

      {petsQuery.isError ? (
        <div className="alert">{String((petsQuery.error as Error).message)}</div>
      ) : null}

      <div className="grid">
        {pets.slice(0, 12).map((pet) => (
          <div key={pet.id} className="card card--static">
            <div className="card__title">
              {pet.name} <StatusBadge status={pet.status} />
            </div>
            <div className="muted">#{pet.id}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
