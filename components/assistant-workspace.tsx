"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type Approval = { id: string; hash: string; version: string; status: string; expiresAt: string;
  plan?: { tool: string; sourceTitle: string }; outcome?: unknown };
type Context = { attachments: { id: string; title: string }[]; approvals: Approval[] };
type Response = { status: string; identity?: string; model?: string; tool?: string; validation?: string; message?: string; result?: unknown };
type Mode = "strict" | "model_only" | "comparison";

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "The request failed.");
  return body;
}

const post = (value: object): RequestInit => ({
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
});
const input = "w-full min-w-0 rounded-md border border-[var(--line)] bg-[var(--page)] p-2";
const panel = "min-w-0 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-6";
const resultStyle = "whitespace-pre-wrap wrap-anywhere text-sm";

export function AssistantWorkspace({ writerModel, shareEnabled, comparisonConfigured, routingConfigured }: {
  writerModel: string | null; shareEnabled: boolean; comparisonConfigured: boolean; routingConfigured: boolean;
}) {
  const [context, setContext] = useState<Context>();
  const [request, setRequest] = useState("");
  const [mode, setMode] = useState<Mode>("strict");
  const [active, setActive] = useState<string[]>([]);
  const [writer, setWriter] = useState(false);
  const [share, setShare] = useState(false);
  const [result, setResult] = useState<Response>();
  const [error, setError] = useState("");
  const [contextError, setContextError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  function refresh(signal?: AbortSignal) {
    return jsonRequest<Context>("/api/agent", { signal })
      .then((item) => { if (!signal?.aborted) { setContext(item); setContextError(""); } })
      .catch((failure) => { if (!signal?.aborted) setContextError(failure.message); });
  }
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, []);

  async function run() {
    if (lock.current || !request.trim()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      const answer = await jsonRequest<Response>("/api/agent", post({ id: crypto.randomUUID(),
        request, mode, active, writer: mode === "strict" && writer, share: mode === "strict" && writer && share }));
      setResult(answer);
      await refresh();
    } catch (failure) { setError((failure as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }

  async function approve(item: Approval) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await jsonRequest("/api/agent/approvals/" + item.id, post({ hash: item.hash }));
      await refresh();
    } catch (failure) { setError((failure as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }

  const available = mode === "comparison" ? comparisonConfigured : routingConfigured;

  return <>
    <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Assistant</h1>
    <form className={panel + " grid gap-4"} onSubmit={(event) => { event.preventDefault(); void run(); }}>
      <label className="grid gap-1">Mode
        <select className={input} value={mode} onChange={(event) => setMode(event.target.value as Mode)}>
          <option value="strict">Strict execution</option><option value="model_only">Distil model only</option>
          <option value="comparison">Comparison model only</option>
        </select>
      </label>
      {!available && <p>Configure the selected routing model in <Link className="underline" href="/settings">Settings</Link>.</p>}
      <label className="grid gap-1">Request
        <textarea rows={4} required maxLength={2000} className={input} value={request} onChange={(event) => setRequest(event.target.value)} />
      </label>
      <fieldset className="grid gap-2">
        <legend>Active document references</legend>
        {!context?.attachments.length && <p className="text-sm">Select attachments in <Link className="underline" href="/documents">Documents</Link>.</p>}
        {context?.attachments.map(({ id, title }) => <label key={id} className="flex gap-2 wrap-anywhere">
          <input type="checkbox" checked={active.includes(id)} disabled={active.length >= 5 && !active.includes(id)}
            onChange={(event) => setActive((current) => event.target.checked ? [...current, id] : current.filter((key) => key !== id))} />
          {active.includes(id) && <span>@active:{active.indexOf(id) + 1}</span>}<span>{title}</span>
        </label>)}
      </fieldset>
      {mode === "strict" && writerModel && <label className="flex gap-2">
        <input type="checkbox" checked={writer} onChange={(event) => setWriter(event.target.checked)} />Use {writerModel} as writer for drafts and summaries
      </label>}
      {mode === "strict" && writer && <label className="flex gap-2">
        <input type="checkbox" checked={share && shareEnabled} disabled={!shareEnabled}
          onChange={(event) => setShare(event.target.checked)} />Share selected document excerpts for this turn{!shareEnabled && " (enable in Preferences first)"}
      </label>}
      <Button disabled={busy || !available || !context} className="justify-self-start">{busy ? "Working…" : "Run turn"}</Button>
    </form>
    {contextError && <p role="alert">{contextError} <Link className="underline" href="/settings">Open Settings</Link></p>}
    {error && <p role="alert" className="text-[var(--error)]">{error}</p>}
    {result && <section className={panel + " grid gap-2"} aria-label="Turn result">
      <h2 className="text-xl font-semibold">{result.tool ?? "Turn result"}</h2>
      {result.model && <p className="text-sm">{result.model} · {result.identity} · {result.status}</p>}
      {result.message && <p>{result.message}</p>}
      {result.status === "pending" && <p>Review the immutable proposal below before approving it.</p>}
      {result.result !== undefined && <pre className={resultStyle}>{JSON.stringify(result.result, null, 2)}</pre>}
    </section>}
    <section className={panel + " grid gap-4"} aria-labelledby="approvals-heading">
      <h2 id="approvals-heading" className="text-xl font-semibold">Approvals</h2>
      {!context?.approvals.length && <p>No proposals recorded.</p>}
      {context?.approvals.map((item) => <article key={item.id} className="grid gap-2 border-t border-[var(--line)] pt-4">
        <p className="font-semibold">{item.plan?.tool ?? "Approval"} · {item.status}</p>
        <p className="text-sm">Version {item.version} · Expires {item.expiresAt}</p>
        <p className="wrap-anywhere text-sm">{item.hash}</p>
        {item.plan && <pre className={resultStyle}>{JSON.stringify(item.plan, null, 2)}</pre>}
        {item.outcome != null && <pre className={resultStyle}>{JSON.stringify(item.outcome, null, 2)}</pre>}
        {item.status === "pending" && item.plan && <Button disabled={busy} className="justify-self-start" onClick={() => void approve(item)}>Approve and execute</Button>}
        {item.status === "executing" && <Button variant="outline" disabled={busy} className="justify-self-start" onClick={() => void approve(item)}>Check execution status</Button>}
      </article>)}
    </section>
  </>;
}
