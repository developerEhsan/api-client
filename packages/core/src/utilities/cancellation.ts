/**
 * Request cancellation: per-key abort tracking with debounce-cancel (X3),
 * external signal linking (X2/X4 propagation), and abort-error detection.
 * No IO; wraps the platform {@link AbortController}.
 */

/** Coordinates AbortSignals across in-flight requests keyed by string. */
export interface CancellationManager {
  /**
   * Acquire an AbortSignal for a request. If dedupeWindow>0 and a prior live
   * acquire for the same key exists, abort the PREVIOUS one (debounce-cancel, spec X3)
   * so the newest call wins. Merges an optional external signal (aborting it aborts this).
   * Returns the signal plus a settle() to call when the request finishes (frees tracking).
   */
  acquire(key: string, externalSignal?: AbortSignal): { signal: AbortSignal; settle: () => void }
  /** Abort the live controller for a key, if any. */
  cancel(key: string): void
  activeKeys(): number
}

/**
 * Create a {@link CancellationManager}.
 *
 * - `dedupeWindow` (ms): when > 0, a fresh {@link CancellationManager.acquire}
 *   for a key that already has a live controller aborts the previous one so the
 *   newest call wins (spec X3). When 0 (default), acquires are independent.
 */
export function createCancellationManager(
  config?: { dedupeWindow?: number },
): CancellationManager {
  const dedupeWindow = config?.dedupeWindow ?? 0
  interface LiveEntry {
    controller: AbortController
    /** Removes external->internal abort listeners (prevents listener leaks). */
    dispose: () => void
    /** Epoch ms the acquire started, for the debounce-window comparison. */
    startedAt: number
  }
  /** Live entries per key. A key holds only its most recent controller. */
  const live = new Map<string, LiveEntry>()

  return {
    acquire(key: string, externalSignal?: AbortSignal): { signal: AbortSignal; settle: () => void } {
      const previous = live.get(key)
      if (previous && dedupeWindow > 0) {
        // Debounce-cancel only when the previous acquire started within the
        // window (spec X3). Outside the window it is a legitimate long-running
        // request and is left to complete.
        if (Date.now() - previous.startedAt <= dedupeWindow) {
          previous.dispose()
          previous.controller.abort()
        }
      }

      const { controller, dispose } = mergeSignals(externalSignal)
      const entry: LiveEntry = { controller, dispose, startedAt: Date.now() }
      live.set(key, entry)

      const settle = (): void => {
        // Detach listeners always; drop tracking only if still the live entry.
        dispose()
        if (live.get(key) === entry) live.delete(key)
      }

      return { signal: controller.signal, settle }
    },

    cancel(key: string): void {
      const entry = live.get(key)
      if (!entry) return
      live.delete(key)
      entry.dispose()
      entry.controller.abort()
    },

    activeKeys(): number {
      return live.size
    },
  }
}

/**
 * Merge external signals into a fresh controller, returning the controller plus
 * a `dispose` that removes the attached listeners — so a request that settles
 * normally does not leak a listener on a long-lived external signal.
 */
function mergeSignals(
  ...signals: (AbortSignal | undefined)[]
): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController()
  const detachers: Array<() => void> = []

  for (const signal of signals) {
    if (!signal) continue
    if (signal.aborted) {
      controller.abort((signal as { reason?: unknown }).reason)
      break
    }
    const onAbort = (): void => controller.abort((signal as { reason?: unknown }).reason)
    signal.addEventListener('abort', onAbort)
    detachers.push(() => signal.removeEventListener('abort', onAbort))
  }

  return {
    controller,
    dispose: () => {
      for (const detach of detachers) detach()
    },
  }
}

/** True when `err` is an abort error (DOMException/Error with name 'AbortError'). */
export function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: unknown }).name === 'AbortError'
  )
}

/**
 * Return an {@link AbortController} that aborts as soon as ANY input signal
 * aborts. Undefined inputs are ignored. If any input is already aborted, the
 * returned controller is aborted immediately.
 */
export function linkSignals(...signals: (AbortSignal | undefined)[]): AbortController {
  const controller = new AbortController()

  for (const signal of signals) {
    if (!signal) continue
    if (signal.aborted) {
      controller.abort((signal as { reason?: unknown }).reason)
      break
    }
    signal.addEventListener(
      'abort',
      () => controller.abort((signal as { reason?: unknown }).reason),
      { once: true },
    )
  }

  return controller
}
