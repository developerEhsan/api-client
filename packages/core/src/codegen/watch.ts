/**
 * Watch an OpenAPI source and regenerate on change.
 *
 * - Local path: `fs.watch` with a short debounce.
 * - http(s) URL: conditional-GET polling (ETag + full-document hash) so an
 *   unchanged spec never triggers a regenerate or a redundant download.
 *
 * Each regeneration first computes a real per-operation {@link SchemaDiff}
 * (added/removed/changed) and reports it via `onChange`.
 */
import { watch as fsWatch } from 'node:fs';
import type { SchemaDiff } from '../types/openapi.types';
import type { CodegenConfig } from './config';
import { diff, generate } from './generate';

/** Handlers for {@link watchAndGenerate}. */
export interface WatchHandlers {
  /** Called after each successful regeneration with the operation-level diff. */
  onChange?: (diff: SchemaDiff) => void;
  /** Called on any regeneration/poll error (watching continues). */
  onError?: (error: unknown) => void;
}

/** A running watcher; call {@link WatchController.close} to stop it. */
export interface WatchController {
  close(): void;
}

function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

/**
 * Start watching `config.input` and regenerating into `config.output`. Performs
 * one initial generation immediately, then watches. Returns a controller whose
 * `close()` stops watching and cancels any pending work.
 *
 * @example
 * import { watchAndGenerate } from '@developerehsan/api-client/codegen'
 *
 * const watcher = watchAndGenerate(
 *   { input: './openapi.json', output: './src/generated' },
 *   { onChange: (diff) => console.log(`+${diff.addedOperations.length} operations`) },
 * )
 * // …later
 * watcher.close()
 *
 * @example
 * // Poll a remote spec every 15s (ETag/hash-aware, so unchanged specs are free):
 * watchAndGenerate({
 *   input: 'https://api.example.com/openapi.json',
 *   output: './src/generated',
 *   watch: { pollIntervalMs: 15_000 },
 * })
 */
export function watchAndGenerate(
  config: CodegenConfig,
  handlers: WatchHandlers = {},
): WatchController {
  const { onChange, onError } = handlers;
  let closed = false;

  const regenerate = async (): Promise<void> => {
    if (closed) return;
    try {
      // Diff BEFORE writing so it reflects this change (new input vs prior output).
      const d = await diff(config.input, config.output, headersOpt());
      await generate({
        input: config.input,
        output: config.output,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        ...(config.headers ? { headers: config.headers } : {}),
        generatedAt: new Date().toISOString(),
      });
      onChange?.(d);
    } catch (error) {
      onError?.(error);
    }
  };

  const headersOpt = () => (config.headers ? { headers: config.headers } : {});

  // Initial generation.
  void regenerate();

  if (isHttpUrl(config.input)) {
    const intervalMs = config.watch?.pollIntervalMs ?? 30_000;
    let lastEtag: string | undefined;
    let lastHash: string | undefined;
    let inFlight = false;

    const poll = async (): Promise<void> => {
      if (closed || inFlight) return;
      inFlight = true;
      try {
        // Lightweight conditional check; regenerate only when the doc changed.
        const { fnv1aOf, notModified, etag } = await headOrGet(config.input, {
          ...headersOpt(),
          ...(lastEtag ? { etag: lastEtag } : {}),
        });
        if (etag) lastEtag = etag;
        if (notModified) return;
        if (fnv1aOf !== undefined && fnv1aOf === lastHash) return;
        lastHash = fnv1aOf;
        await regenerate();
      } catch (error) {
        onError?.(error);
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(() => void poll(), intervalMs);
    // Do not keep the event loop alive solely for polling.
    if (typeof timer.unref === 'function') timer.unref();
    return {
      close() {
        closed = true;
        clearInterval(timer);
      },
    };
  }

  // Local file watching with a debounce (coalesce rapid editor writes).
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const watcher = fsWatch(config.input, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void regenerate(), 100);
  });
  return {
    close() {
      closed = true;
      if (debounce) clearTimeout(debounce);
      watcher.close();
    },
  };
}

/**
 * Fetch just enough to decide whether the remote spec changed: a conditional
 * GET returning either 304 (not modified) or the body's hash. Kept internal to
 * the watcher.
 */
async function headOrGet(
  url: string,
  opts: { headers?: Record<string, string>; etag?: string },
): Promise<{ fnv1aOf?: string; notModified?: boolean; etag?: string }> {
  const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
  if (opts.etag) headers['if-none-match'] = opts.etag;
  const res = await fetch(url, { headers });
  if (res.status === 304) return { notModified: true, ...(opts.etag ? { etag: opts.etag } : {}) };
  const etag = res.headers.get('etag') ?? undefined;
  const text = await res.text();
  return { fnv1aOf: fnv1a(text), ...(etag ? { etag } : {}) };
}

/** Local FNV-1a (mirrors generate.ts) so the watcher stays dependency-light. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
