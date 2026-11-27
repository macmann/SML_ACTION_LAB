"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "./ui/button";

type TestCase = { id: string; request?: string; instruction?: string; source?: string };
type Run = { id: string; model: string; result: { mode: string; provider: string; identity: string; caseId: string;
  draft?: string; source?: string; error?: string; latencyMs: number; expected?: unknown; validation?: string; predictedTool?: string;
  arguments?: unknown; schemaValid?: boolean; toolCorrect?: boolean; exact?: boolean; fixture?: string; usage?: unknown }; faithfulness?: number };
type Score = { key: string; total: number; toolCorrect: number; schemaValid: number; exact: number; controls: number;
  controlCorrect: number; fixtureRuns: number; fixturePassed: number; failed: number };
type View = { routing: TestCase[]; generation: TestCase[]; providers: { role: string; model: string }[];
  runs: Run[]; scores: Score[]; vendor: { id: string; variant: string; source: string; samples: number; correct: number }[] };
const panel = "grid min-w-0 gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-6";
const field = "w-full min-w-0 rounded-md border border-[var(--line)] bg-[var(--page)] p-2";

async function request<T>(body?: object): Promise<T> {
  const response = await fetch("/api/arena", body ? { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body) } : undefined);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Arena request failed.");
  return data;
}

export function ModelArena() {
  const [view, setView] = useState<View>();
  const [mode, setMode] = useState<"routing" | "generation">("routing");
  const [cases, setCases] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const cap = cases.length * roles.length;
  useEffect(() => {
    let alive = true;
    request<View>().then((value) => { if (alive) setView(value); }).catch((error) => { if (alive) setError(error.message); });
    return () => { alive = false; };
  }, []);
  async function submit(body: object) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError("");
    try { await request(body); setView(await request<View>()); }
    catch (error) { setError((error as Error).message); }
    finally { lock.current = false; setBusy(false); setConfirm(false); }
  }
  return <>
    <h1 className="text-3xl font-semibold sm:text-4xl">Model Arena</h1>
    {error && <p role="alert">{error} <Link className="underline" href="/settings">Settings</Link></p>}
    {!view && !error && <p role="status">Loading Arena…</p>}
    {view && <>
      <form className={panel} onSubmit={(event) => {
        event.preventDefault(); if (confirm && cap) void submit({ operation: "run",
          input: { batchId: crypto.randomUUID(), mode, cases, roles, cap, confirmed: true } });
      }}>
        <label className="grid gap-1">Evaluation mode<select className={field} value={mode} onChange={(event) => {
          setMode(event.target.value as typeof mode); setCases([]); setRoles([]); setConfirm(false);
        }}><option value="routing">Locked routing holdout</option><option value="generation">Generation only</option></select></label>
        <label className="grid gap-1">Cases, up to four
          <select className={field} multiple size={5} value={cases} onChange={(event) => {
            setCases(Array.from(event.target.selectedOptions).slice(0, 4).map((option) => option.value)); setConfirm(false);
          }}>
            {view[mode].map((item) => <option key={item.id} value={item.id}>{item.request ?? item.instruction}</option>)}
          </select>
        </label>
        <fieldset className="grid gap-2"><legend>Configured profiles, up to two</legend>
          {view.providers.filter(({ role }) => mode === "generation" || role !== "writer").map(({ role, model }) =>
            <label key={role} className="flex gap-2 wrap-anywhere"><input type="checkbox" checked={roles.includes(role)}
              disabled={roles.length === 2 && !roles.includes(role)} onChange={(e) => {
                setRoles(e.target.checked ? [...roles, role] : roles.filter((item) => item !== role)); setConfirm(false);
              }} />{role} · {model}</label>)}
          {!view.providers.length && <p>Configure a provider in Settings.</p>}
        </fieldset>
        <label className="flex gap-2"><input type="checkbox" checked={confirm} disabled={!cap} onChange={(e) => setConfirm(e.target.checked)} />
          Authorize up to {cap} model requests for this batch. Provider charges may apply.</label>
        <Button className="justify-self-start" disabled={busy || !confirm || !cap}>{busy ? "Working…" : "Run selected cases"}</Button>
      </form>

      <section className={panel} aria-label="Local routing scores">
        <h2 className="text-xl font-semibold">Local routing scores</h2>
        <p className="text-sm">Aggregates cover the latest 200 recorded Arena runs.</p>
        {!view.scores.length && <p>No routing runs recorded.</p>}
        {view.scores.map((score) => <div key={score.key} className="grid gap-1 border-t border-[var(--line)] pt-2 wrap-anywhere">
          <p className="font-medium">{score.key}</p>
          <p>Tool {score.toolCorrect}/{score.total} · Schema {score.schemaValid}/{score.total} · Exact {score.exact}/{score.total}</p>
          <p>Controls {score.controlCorrect}/{score.controls} · Fixture {score.fixturePassed}/{score.fixtureRuns} · Failures {score.failed}/{score.total}</p>
        </div>)}
        <div className="flex flex-wrap gap-3"><Link className="underline" href="/api/arena?export=json" prefetch={false} download="arena-scores.json">Download JSON scores</Link>
          <Link className="underline" href="/api/arena?export=csv" prefetch={false} download="arena-runs.csv">Download CSV runs</Link></div>
      </section>

      <section className={panel} aria-label="Vendor aggregate reports">
        <h2 className="text-xl font-semibold">Distil vendor aggregates</h2>
        {view.vendor.map((item) => <p key={item.id} className="wrap-anywhere">{item.variant} · {item.correct}/{item.samples} · {item.source}</p>)}
        <form className="grid gap-2" onSubmit={(e) => {
          e.preventDefault(); const form = new FormData(e.currentTarget);
          void submit({ operation: "vendor", variant: form.get("variant"), source: form.get("source"),
            samples: Number(form.get("samples")), correct: Number(form.get("correct")) });
        }}>
          <label className="grid gap-1">Vendor model variant<select name="variant" className={field}><option>base</option><option>tuned</option></select></label>
          <label className="grid gap-1">Report reference<input className={field} name="source" maxLength={140} required /></label>
          <label className="grid gap-1">Vendor sample count<input className={field} name="samples" type="number" min={1} required /></label>
          <label className="grid gap-1">Vendor correct count<input className={field} name="correct" type="number" min={0} required /></label>
          <Button className="justify-self-start" disabled={busy}>Record vendor aggregate</Button>
        </form>
      </section>

      <section className={panel} aria-label="Run details">
        <h2 className="text-xl font-semibold">Run details</h2>
        {view.runs.map((run) => <details key={run.id} className="border-t border-[var(--line)] pt-2 wrap-anywhere">
          <summary className="cursor-pointer">{run.result.caseId} · {run.model} · {run.result.identity} · {run.result.latencyMs} ms</summary>
          {run.result.error && <p>{run.result.error}</p>}
          {run.result.mode === "routing" && <pre className="whitespace-pre-wrap text-sm wrap-anywhere">{JSON.stringify({
            predicted: run.result.predictedTool, arguments: run.result.arguments, expected: run.result.expected,
            validation: run.result.validation, fixture: run.result.fixture, usage: run.result.usage,
          }, null, 2)}</pre>}
          {run.result.draft && <>
            <p className="mt-2 whitespace-pre-wrap">Source · {run.result.source}</p>
            <p className="whitespace-pre-wrap">Draft · {run.result.draft}</p>
            <form className="mt-2 grid gap-2" onSubmit={(e) => {
              e.preventDefault(); const data = new FormData(e.currentTarget);
              void submit({ operation: "review", id: run.id, faithfulness: Number(data.get("score")), notes: data.get("notes") });
            }}>
              <label className="grid gap-1">Human faithfulness
                <select className={field} name="score" defaultValue={run.faithfulness ?? 3}>
                  <option value={0}>0 · Contradicts the source</option><option value={1}>1 · Major unsupported claims</option>
                  <option value={2}>2 · Minor unsupported claims or omissions</option><option value={3}>3 · Faithful to source</option>
                </select>
              </label>
              <label className="grid gap-1">Review notes<input className={field} name="notes" maxLength={1000} /></label>
              <Button className="justify-self-start" disabled={busy}>Save human review</Button>
              {run.faithfulness != null && <p>Recorded score {run.faithfulness}/3</p>}
            </form>
          </>}
        </details>)}
      </section>
    </>}
  </>;
}
