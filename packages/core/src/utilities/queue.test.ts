import { describe, expect, it, vi } from 'vitest';
import { createQueue } from './queue';

/** Deferred promise helper for controlling task settlement in tests. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createQueue', () => {
  it('caps concurrency: never more than `concurrency` active', async () => {
    const q = createQueue({ concurrency: 2 });
    const gates = Array.from({ length: 5 }, () => deferred<void>());
    let active = 0;
    let maxActive = 0;

    const results = gates.map((g) =>
      q.add(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await g.promise;
        active--;
      }),
    );

    // Let microtasks flush so the first batch starts.
    await Promise.resolve();
    expect(q.active()).toBe(2);
    expect(q.size()).toBe(3);

    // Settle tasks one at a time.
    for (const g of gates) {
      g.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    await Promise.all(results);
    expect(maxActive).toBe(2);
    expect(q.active()).toBe(0);
    expect(q.size()).toBe(0);
  });

  it('runs waiting tasks in FIFO order', async () => {
    const q = createQueue({ concurrency: 1, priority: 'fifo' });
    const order: number[] = [];
    const first = deferred<void>();

    // Block the single slot.
    const blocker = q.add(async () => {
      await first.promise;
    });
    const p1 = q.add(async () => {
      order.push(1);
    });
    const p2 = q.add(async () => {
      order.push(2);
    });
    const p3 = q.add(async () => {
      order.push(3);
    });

    first.resolve();
    await Promise.all([blocker, p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('runs waiting tasks in LIFO order', async () => {
    const q = createQueue({ concurrency: 1, priority: 'lifo' });
    const order: number[] = [];
    const first = deferred<void>();

    const blocker = q.add(async () => {
      await first.promise;
    });
    const p1 = q.add(async () => {
      order.push(1);
    });
    const p2 = q.add(async () => {
      order.push(2);
    });
    const p3 = q.add(async () => {
      order.push(3);
    });

    first.resolve();
    await Promise.all([blocker, p1, p2, p3]);
    expect(order).toEqual([3, 2, 1]);
  });

  it('rejects immediately if signal already aborted', async () => {
    const q = createQueue({ concurrency: 1 });
    const controller = new AbortController();
    controller.abort();
    const task = vi.fn(async () => 'x');

    await expect(q.add(task, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(task).not.toHaveBeenCalled();
  });

  it('abort before start removes from queue and rejects without running', async () => {
    const q = createQueue({ concurrency: 1 });
    const controller = new AbortController();
    const first = deferred<void>();
    const queuedTask = vi.fn(async () => 'ran');

    const blocker = q.add(async () => {
      await first.promise;
    });
    const queued = q.add(queuedTask, { signal: controller.signal });

    expect(q.size()).toBe(1);
    controller.abort();

    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    expect(q.size()).toBe(0);
    expect(queuedTask).not.toHaveBeenCalled();

    first.resolve();
    await blocker;
  });

  it('releases the slot when a task rejects', async () => {
    const q = createQueue({ concurrency: 1 });
    const p1 = q.add(async () => {
      throw new Error('boom');
    });
    await expect(p1).rejects.toThrow('boom');

    const p2 = q.add(async () => 42);
    await expect(p2).resolves.toBe(42);
    expect(q.active()).toBe(0);
  });

  it('defaults to concurrency 10 and fifo', async () => {
    const q = createQueue();
    const gate = deferred<void>();
    const tasks = Array.from({ length: 12 }, () => q.add(async () => await gate.promise));
    await Promise.resolve();
    expect(q.active()).toBe(10);
    expect(q.size()).toBe(2);
    gate.resolve();
    await Promise.all(tasks);
  });
});
