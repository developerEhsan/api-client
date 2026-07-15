import { ApiError } from '@developerehsan/api-client';
/**
 * DIRECT CLIENT USAGE
 * -------------------
 * Call the typed client straight from components. Every method is fully typed
 * from the OpenAPI spec — inputs are checked, results are inferred:
 *
 *   api.pet.findPetsByStatus({ status })   -> Promise<Pet[]>
 *   api.pet.getPetById({ petId })          -> Promise<Pet>
 *
 * This section shows: typed query params, typed path params, loading/error
 * states, and typed error handling (ApiError with a real HTTP status).
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Panel, Spinner, StatusBadge } from '../components/ui';
import { api } from '../lib/api/api.config';
import type { Pet } from '../lib/api/types/generated/api.types';

type Status = 'available' | 'pending' | 'sold';

export function DirectClientDemo() {
  const [status, setStatus] = useState<Status>('available');
  const [pets, setPets] = useState<Pet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Pet | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const load = useCallback(async (next: Status) => {
    setLoading(true);
    setError(null);
    const started = performance.now();
    try {
      // `status` is a typed enum — try changing it to an invalid value and TS errors.
      const result = await api.pet.findPetsByStatus({ status: next });
      setPets(result.slice(0, 12));
      setElapsed(Math.round(performance.now() - started));
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status ?? ''} ${err.message}` : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [status, load]);

  const openDetail = useCallback(async (petId: number) => {
    try {
      // Path param `{petId}` is typed and required.
      const pet = await api.pet.getPetById({ petId });
      setSelected(pet);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status ?? ''} ${err.message}` : String(err));
    }
  }, []);

  return (
    <Panel
      title="Browse pets (direct typed client)"
      subtitle="api.pet.findPetsByStatus({ status }) → Pet[]. Second load of the same status is served instantly from the SWR cache."
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
        <Button onClick={() => load(status)}>Reload</Button>
        {loading ? <Spinner /> : null}
        {elapsed !== null ? <span className="muted">loaded in {elapsed} ms</span> : null}
      </div>

      {error ? <div className="alert">{error}</div> : null}

      <div className="grid">
        {pets.map((pet) => (
          <button
            key={pet.id}
            type="button"
            className="card"
            onClick={() => pet.id != null && openDetail(pet.id)}
          >
            <div className="card__title">
              {pet.name} <StatusBadge status={pet.status} />
            </div>
            <div className="muted">#{pet.id}</div>
            {pet.category?.name ? <div className="chip">{pet.category.name}</div> : null}
          </button>
        ))}
        {!loading && pets.length === 0 ? <p className="muted">No pets for “{status}”.</p> : null}
      </div>

      {selected ? (
        <div className="detail">
          <div className="detail__head">
            <strong>{selected.name}</strong> <StatusBadge status={selected.status} />
            <Button className="btn--ghost" onClick={() => setSelected(null)}>
              close
            </Button>
          </div>
          <pre className="code">{JSON.stringify(selected, null, 2)}</pre>
        </div>
      ) : null}
    </Panel>
  );
}
