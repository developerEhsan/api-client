/**
 * Tiny presentational helpers + a log hook shared across the demo sections.
 * Nothing library-specific here except `useEventLog`, which subscribes to the
 * client's event emitter (`api.on(...)`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api/api.config";

export function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel__head">
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );
}

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`btn ${props.className ?? ""}`} />;
}

export function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  return <span className={`badge badge--${status}`}>{status}</span>;
}

export function Spinner() {
  return <span className="spinner" aria-label="loading" />;
}

export type LogLine = { id: number; kind: "info" | "req" | "res" | "err"; text: string };

/** A simple append-only log with a helper to push lines. */
export function useLog() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const idRef = useRef(0);
  const push = useCallback((kind: LogLine["kind"], text: string) => {
    setLines((prev) => [...prev.slice(-80), { id: idRef.current++, kind, text }]);
  }, []);
  const clear = useCallback(() => setLines([]), []);
  return { lines, push, clear };
}

export function LogView({ lines }: { lines: LogLine[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);
  return (
    <div className="log">
      {lines.length === 0 ? <div className="log__empty">No activity yet.</div> : null}
      {lines.map((l) => (
        <div key={l.id} className={`log__line log__line--${l.kind}`}>
          {l.text}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

/**
 * Subscribe to the client's pipeline events and mirror them into a log. This is
 * how you observe requests/responses/errors app-wide (great for debugging).
 */
export function useEventLog(enabled: boolean) {
  const { lines, push, clear } = useLog();
  useEffect(() => {
    if (!enabled) return;
    const onReq = (p: unknown) => {
      const r = p as { method: string; url: string };
      push("req", `→ ${r.method} ${r.url}`);
    };
    const onRes = (p: unknown) => {
      const r = p as { status: number; fromCache?: boolean };
      push("res", `← ${r.status}${r.fromCache ? " (from cache)" : ""}`);
    };
    const onErr = (p: unknown) => {
      const e = p as { name: string; status?: number; message: string };
      push("err", `✖ ${e.name}${e.status ? ` ${e.status}` : ""}: ${e.message}`);
    };
    api.on("request", onReq);
    api.on("response", onRes);
    api.on("error", onErr);
    return () => {
      api.off("request", onReq);
      api.off("response", onRes);
      api.off("error", onErr);
    };
  }, [enabled, push]);
  return { lines, clear, push };
}
