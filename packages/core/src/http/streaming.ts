/**
 * Streaming response helpers (roadmap E1). Dependency-free parsers that turn a
 * `ReadableStream<Uint8Array>` (from the fetch adapter) into a typed
 * `AsyncIterable`, plus raw byte/line iteration. Used by `ctx.stream`.
 *
 * These are transport-agnostic and safe in any runtime with WHATWG streams
 * (browser, edge, Node 18+).
 */

/** A parsed Server-Sent Event. */
export interface SseEvent {
  /** The `event:` field, or `undefined` for the default (`message`). */
  event?: string;
  /** The joined `data:` field(s). */
  data: string;
  /** The `id:` field, if present. */
  id?: string;
}

/** Iterate the raw byte chunks of a stream (aborts cleanly on `signal`). */
export async function* iterateBytes(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      if (signal?.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Read a byte stream as a sequence of text lines (handles CRLF/LF, buffers partials). */
export async function* iterateLines(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      if (signal?.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      // Split on \n; strip a trailing \r for CRLF streams.
      // biome-ignore lint/suspicious/noAssignInExpressions: standard buffered-line-split idiom.
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        yield line;
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield buffer.replace(/\r$/, '');
  } finally {
    reader.releaseLock();
  }
}

/**
 * Iterate newline-delimited JSON (NDJSON), yielding each parsed value.
 *
 * @example
 * // Inside a module method, stream a chat/completions-style NDJSON endpoint:
 * chat: async (ctx, prompt: string) => {
 *   for await (const chunk of ctx.stream<{ token: string }>(
 *     { method: 'POST', path: '/chat', body: { prompt } },
 *     { mode: 'ndjson' },
 *   )) {
 *     process.stdout.write(chunk.token)
 *   }
 * }
 */
export async function* parseNdjson<T = unknown>(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  for await (const line of iterateLines(stream, signal)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    yield JSON.parse(trimmed) as T;
  }
}

/**
 * Iterate a Server-Sent Events stream (`text/event-stream`), yielding one
 * {@link SseEvent} per event block (separated by a blank line). Comment lines
 * (starting `:`) are ignored.
 *
 * @example
 * for await (const ev of ctx.stream<SseEvent>(
 *   { method: 'GET', path: '/events' },
 *   { mode: 'sse' },
 * )) {
 *   if (ev.event === 'price') console.log(JSON.parse(ev.data))
 * }
 */
export async function* parseSse(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  let event: string | undefined;
  let id: string | undefined;
  const dataLines: string[] = [];

  const flush = (): SseEvent | undefined => {
    if (dataLines.length === 0 && event === undefined && id === undefined) return undefined;
    const out: SseEvent = { data: dataLines.join('\n') };
    if (event !== undefined) out.event = event;
    if (id !== undefined) out.id = id;
    event = undefined;
    id = undefined;
    dataLines.length = 0;
    return out;
  };

  for await (const line of iterateLines(stream, signal)) {
    if (line === '') {
      const ev = flush();
      if (ev && (ev.data.length > 0 || ev.event !== undefined)) yield ev;
      continue;
    }
    if (line.startsWith(':')) continue; // comment
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    // A leading space after the colon is stripped per the SSE spec.
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    switch (field) {
      case 'event':
        event = value;
        break;
      case 'data':
        dataLines.push(value);
        break;
      case 'id':
        id = value;
        break;
      default:
        break; // ignore unknown fields (e.g. retry)
    }
  }
  const tail = flush();
  if (tail && (tail.data.length > 0 || tail.event !== undefined)) yield tail;
}

/** A DOMException-shaped AbortError (falls back to a plain Error). */
function abortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('The operation was aborted.', 'AbortError');
  }
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}
