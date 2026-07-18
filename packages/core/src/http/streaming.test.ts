/**
 * Streaming parser tests (E1): NDJSON, SSE, raw bytes, partial-chunk buffering,
 * and abort handling.
 */
import { describe, expect, it } from 'vitest';
import { iterateBytes, iterateLines, parseNdjson, parseSse } from './streaming';

const enc = new TextEncoder();

/** A ReadableStream that emits the given string chunks in order. */
function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('parseNdjson', () => {
  it('parses newline-delimited JSON, including a no-trailing-newline last line', async () => {
    const s = streamOf('{"a":1}\n{"a":2}\n', '{"a":3}');
    expect(await collect(parseNdjson<{ a: number }>(s))).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('reassembles values split across chunk boundaries', async () => {
    const s = streamOf('{"hel', 'lo":', '"world"}\n');
    expect(await collect(parseNdjson(s))).toEqual([{ hello: 'world' }]);
  });

  it('skips blank lines', async () => {
    const s = streamOf('{"a":1}\n\n\n{"a":2}\n');
    expect(await collect(parseNdjson(s))).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe('parseSse', () => {
  it('parses events with event/data/id and multi-line data', async () => {
    const s = streamOf('event: ping\ndata: hello\ndata: world\nid: 1\n\n', 'data: bye\n\n');
    expect(await collect(parseSse(s))).toEqual([
      { event: 'ping', data: 'hello\nworld', id: '1' },
      { data: 'bye' },
    ]);
  });

  it('ignores comment lines', async () => {
    const s = streamOf(': keep-alive\ndata: x\n\n');
    expect(await collect(parseSse(s))).toEqual([{ data: 'x' }]);
  });
});

describe('iterateLines / iterateBytes', () => {
  it('handles CRLF line endings', async () => {
    const s = streamOf('a\r\nb\r\n', 'c');
    expect(await collect(iterateLines(s))).toEqual(['a', 'b', 'c']);
  });

  it('yields raw byte chunks', async () => {
    const s = streamOf('ab', 'cd');
    const chunks = await collect(iterateBytes(s));
    expect(chunks.map((c) => new TextDecoder().decode(c))).toEqual(['ab', 'cd']);
  });

  it('aborts promptly when the signal fires', async () => {
    const controller = new AbortController();
    const s = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('{"a":1}\n'));
        // never closes
      },
    });
    controller.abort();
    await expect(collect(parseNdjson(s, controller.signal))).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
