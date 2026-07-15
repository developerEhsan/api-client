/**
 * Concurrency-limited task queue with FIFO/LIFO scheduling and pre-start
 * abort support. No IO; slots are released when a task settles (spec 3.1, 6.5).
 */

/** A concurrency-gated task runner. */
export interface ConcurrencyQueue {
  /**
   * Enqueue a task; it runs once a concurrency slot is free. If `opts.signal`
   * aborts before the task starts, it is removed from the queue and the
   * returned promise rejects with an `AbortError` (the task never runs).
   */
  add<T>(task: () => Promise<T>, opts?: { signal?: AbortSignal }): Promise<T>;
  /** Number of tasks queued but not yet started. */
  size(): number;
  /** Number of tasks currently running. */
  active(): number;
}

/** Options for {@link createQueue}. */
export interface QueueOptions {
  /** Maximum tasks running at once. Default: 10. */
  concurrency?: number;
  /** Scheduling order for waiting tasks. Default: `'fifo'`. */
  priority?: 'fifo' | 'lifo';
}

interface QueuedItem {
  run: () => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/** Build an `AbortError`, preferring `DOMException` when available (X5). */
function makeAbortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('The operation was aborted.', 'AbortError');
  }
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

/**
 * Create a {@link ConcurrencyQueue} that runs at most `concurrency` tasks
 * simultaneously, dispatching waiting tasks in FIFO or LIFO order.
 */
export function createQueue(config?: QueueOptions): ConcurrencyQueue {
  const concurrency = Math.max(1, config?.concurrency ?? 10);
  const priority = config?.priority ?? 'fifo';

  const waiting: QueuedItem[] = [];
  let running = 0;

  function dispatch(): void {
    while (running < concurrency && waiting.length > 0) {
      const item = priority === 'lifo' ? waiting.pop() : waiting.shift();
      if (item === undefined) return;
      if (item.signal !== undefined && item.onAbort !== undefined) {
        item.signal.removeEventListener('abort', item.onAbort);
      }
      running++;
      item.run();
    }
  }

  function add<T>(task: () => Promise<T>, opts?: { signal?: AbortSignal }): Promise<T> {
    const signal = opts?.signal;
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(makeAbortError());
        return;
      }

      const item: QueuedItem = {
        run: () => {
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              running--;
              dispatch();
            });
        },
        signal,
      };

      if (signal !== undefined) {
        const onAbort = (): void => {
          const idx = waiting.indexOf(item);
          if (idx !== -1) {
            waiting.splice(idx, 1);
            signal.removeEventListener('abort', onAbort);
            reject(makeAbortError());
          }
        };
        item.onAbort = onAbort;
        signal.addEventListener('abort', onAbort);
      }

      waiting.push(item);
      dispatch();
    });
  }

  return {
    add,
    size: () => waiting.length,
    active: () => running,
  };
}
