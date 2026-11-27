"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "./ui/button";

type Task = { id: string; title: string; status: string; due: string | null; evidence?: { reference: string; quote: string } };
type Note = { id: string; title: string; body: string };
type Invoice = { id: string; number: string; currency: string; customer?: string; status: string; verified: boolean;
  revision: number; issued: string | null; due: string | null; amount: string | null; tax: string | null; total: string | null; source: string | null };
type Expense = { id: string; description: string; incurred: string; amount: string; currency: string };
type Workflow = { id: string; sourceInvoice: string; draftInvoice: string | null; emailDraft: string | null; stage: string };
type Listing = { tasks: Task[]; notes: Note[]; invoices: Invoice[]; expenses: Expense[]; workflows: Workflow[]; outstanding: { currency: string; amount: string }[] };
type Candidate = { title: string; fields: Record<string, { value: string | null; evidence: { evidence: string; source: string }[] }> };
type Approval = { id: string; hash: string; status: string; plan: unknown; outcome?: { message?: string } };
const input = "min-w-0 w-full rounded-md border border-[var(--line)] bg-[var(--page)] p-2";
const panel = "grid min-w-0 gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-6";

async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "The workspace operation failed.");
  return data;
}

function Field({ name, label, value, type = "text", required = true, disabled = false }: {
  name: string; label: string; value?: string | null; type?: string; required?: boolean; disabled?: boolean;
}) {
  return <label className="grid min-w-0 gap-1">{label}
    <input className={input} name={name} type={type} defaultValue={value ?? ""} required={required} readOnly={disabled} maxLength={140} />
  </label>;
}

function Reports({ report }: { report: string }) {
  return <div className="flex flex-wrap gap-3 text-sm" aria-label={report.replaceAll("_", " ") + " exports"}>
    {["xlsx", "csv", "pdf"].map((format) => <a key={format} className="underline" href={"/api/business/reports?report=" + report + "&format=" + format}>
      Download {format.toUpperCase()}</a>)}
  </div>;
}

const values = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  return (name: string) => String(data.get(name) ?? "").trim();
};

export function BusinessWorkspace({ view, source }: { view: "tasks" | "invoices"; source?: string }) {
  const [data, setData] = useState<Listing>();
  const [candidate, setCandidate] = useState<Candidate>();
  const [task, setTask] = useState<Task>();
  const [note, setNote] = useState<Note>();
  const [invoice, setInvoice] = useState<Invoice>();
  const [approval, setApproval] = useState<Approval>();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    request<Listing>("/api/business").then((result) => { if (active) setData(result); }).catch((error) => { if (active) setError(error.message); });
    if (source) request<Candidate>("/api/business/import?source=" + source)
      .then((result) => { if (active) setCandidate(result); }).catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [source]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setStatus("");
    try {
      await action();
      setData(await request<Listing>("/api/business"));
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  const save = (command: object, after?: () => void) => void run(async () => {
    await request("/api/business", command);
    after?.();
    setStatus("Saved.");
  });
  const propose = (command: object) => void run(async () => {
    setApproval(await request<Approval>("/api/business/workflow", command));
    setStatus("Proposal ready for review.");
  });
  const field = (key: string) => candidate?.fields[key]?.value;
  return <>
    <h1 className="text-3xl font-semibold sm:text-4xl">{view === "tasks" ? "Tasks and notes" : "Invoices"}</h1>
    {error && <p role="alert" className="wrap-anywhere text-[var(--error)]">{error} <Link className="underline" href="/settings">Settings</Link></p>}
    {status && <p role="status">{status}</p>}
    {!data && !error && <p role="status">Loading workspace records…</p>}
    {data && view === "tasks" && <>
      <section className={panel} aria-label="Tasks">
        <h2 className="text-xl font-semibold">Tasks</h2><Reports report="tasks" />
        <form className="grid gap-3" key={task?.id ?? "new"} onSubmit={(event) => {
          const form = event.currentTarget;
          const get = values(event);
          save({ operation: "task_save", id: task?.id, input: { title: get("title"), status: get("status"), due: get("due") || null } }, () => { form.reset(); setTask(undefined); });
        }}>
          <Field name="title" label="Task title" value={task?.title} />
          <Field name="due" label="Task due date" type="date" value={task?.due} required={false} />
          <label className="grid gap-1">Task status<select className={input} name="status" defaultValue={task?.status ?? "open"}>
            <option value="open">Open</option><option value="done">Done</option></select></label>
          <div className="flex flex-wrap gap-2"><Button disabled={busy}>{task ? "Save task" : "Add task"}</Button>
            {task && <Button type="button" variant="outline" onClick={() => setTask(undefined)}>Cancel edit</Button>}</div>
        </form>
        {!data.tasks.length && <p>No tasks yet.</p>}
        {data.tasks.map((item) => <article className="grid gap-2 border-t border-[var(--line)] pt-2 wrap-anywhere" key={item.id}>
          <h3 className="font-semibold">{item.title}</h3><p>{item.status}{item.due ? " · due " + item.due : ""}</p>
          {item.evidence && <p className="text-sm">{item.evidence.reference} · {item.evidence.quote}</p>}
          <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setTask(item)}>Edit task</Button>
            <Button variant="outline" disabled={busy} onClick={() => window.confirm("Delete this task?") &&
              save({ operation: "task_delete", id: item.id, confirmed: true }, () => { if (task?.id === item.id) setTask(undefined); })}>Delete task</Button></div>
        </article>)}
      </section>
      <section className={panel} aria-label="Notes">
        <h2 className="text-xl font-semibold">Notes</h2>
        <form className="grid gap-3" key={note?.id ?? "new"} onSubmit={(event) => {
          const form = event.currentTarget;
          const get = values(event);
          save({ operation: "note_save", id: note?.id, input: { title: get("title"), body: get("body") } }, () => { form.reset(); setNote(undefined); });
        }}>
          <Field name="title" label="Note title" value={note?.title} />
          <label className="grid gap-1">Note text<textarea name="body" className={input} rows={4} required maxLength={8000} defaultValue={note?.body} /></label>
          <div className="flex flex-wrap gap-2"><Button disabled={busy}>{note ? "Save note" : "Add note"}</Button>
            {note && <Button type="button" variant="outline" onClick={() => setNote(undefined)}>Cancel edit</Button>}</div>
        </form>
        {!data.notes.length && <p>No notes yet.</p>}
        {data.notes.map((item) => <article className="grid gap-2 border-t border-[var(--line)] pt-2 wrap-anywhere" key={item.id}>
          <h3 className="font-semibold">{item.title}</h3><p className="whitespace-pre-wrap">{item.body}</p>
          <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setNote(item)}>Edit note</Button>
            <Button variant="outline" disabled={busy} onClick={() => window.confirm("Delete this note?") &&
              save({ operation: "note_delete", id: item.id, confirmed: true }, () => { if (note?.id === item.id) setNote(undefined); })}>Delete note</Button></div>
        </article>)}
      </section>
    </>}
    {data && view === "invoices" && <>
      <section className={panel}>
        <h2 className="text-xl font-semibold">{invoice ? "Verify imported invoice" : source ? "Review extracted invoice" : "New invoice draft"}</h2>
        {candidate && <> <p>Source · {candidate.title}</p>
          {Object.entries(candidate.fields).flatMap(([key, value]) => value.evidence.slice(0, 2).map((e, i) =>
            <p className="text-sm wrap-anywhere" key={key + i}>{e.source} · {e.evidence}</p>))} </>}
        <form className="grid gap-3" key={invoice?.id ?? (candidate ? "imported" : "new")} onSubmit={(event) => {
          const get = values(event);
          if (!window.confirm(invoice ? "Verify the corrected invoice details?" : "Record these exact invoice details?")) return;
          save({ operation: invoice ? "invoice_verify" : "invoice_create", id: invoice?.id, revision: invoice?.revision, confirmed: true,
            input: { number: get("number"), customer: get("customer"), currency: get("currency"), amount: get("amount"),
              tax: get("tax") || null, issued: get("issued"), due: get("due"), source: invoice ? invoice.source : source ?? null } },
            () => setInvoice(undefined));
        }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="number" label="Invoice number" value={invoice?.number ?? field("invoice_id")} disabled={Boolean(invoice)} />
            <Field name="customer" label="Customer" value={invoice?.customer ?? field("customer")} />
            <Field name="currency" label="Currency code" value={invoice?.currency ?? field("currency")} />
            <Field name="amount" label="Base amount (exact decimal)" value={invoice?.amount ?? field("amount")} />
            <Field name="tax" label="Tax (optional)" value={invoice?.tax} required={false} />
            <Field name="issued" label="Issue date" type="date" value={invoice?.issued ?? field("invoice_date")} />
            <Field name="due" label="Due date" type="date" value={invoice?.due ?? field("due_date")} />
          </div>
          <div className="flex flex-wrap gap-2"><Button disabled={busy}>{invoice ? "Confirm verification" : source ? "Record unverified import" : "Save draft"}</Button>
            {invoice && <Button type="button" variant="outline" onClick={() => setInvoice(undefined)}>Cancel verification</Button>}</div>
        </form>
      </section>
      <section className={panel}>
        <h2 className="text-xl font-semibold">Outstanding invoices</h2>
        <Reports report="outstanding_invoices" />
        {data.outstanding.length ? data.outstanding.map(({ currency, amount }) => <p key={currency}>{currency} {amount}</p>) : <p>No verified unpaid amounts.</p>}
        {!data.invoices.length && <p>No invoice records yet.</p>}
        {data.invoices.map((item) => <article key={item.id} className="grid gap-2 border-t border-[var(--line)] pt-3 wrap-anywhere">
          <h3 className="font-semibold">{item.number} · {item.customer ?? "Customer unavailable"}</h3>
          <p>{item.status} · {item.verified ? "verified" : "unverified"} · {item.total === null ? "Total unavailable" : item.currency + " " + item.total}</p>
          {!!item.due && <p>Due {item.due}</p>}
          <div className="flex flex-wrap gap-2">
            {item.status === "imported" && <Button variant="outline" onClick={() => setInvoice(item)}>Review import</Button>}
            {item.verified && ["draft", "unpaid"].includes(item.status) && <Button variant="outline" disabled={busy} onClick={() => {
              const next = item.status === "draft" ? "unpaid" : "paid";
              if (window.confirm("Mark " + item.number + " as " + next + "?")) save({ operation: "invoice_status",
                id: item.id, revision: item.revision, status: next, confirmed: true });
            }}>{item.status === "draft" ? "Mark unpaid" : "Mark paid"}</Button>}
          </div>
          {item.verified && <details className="grid gap-2">
            <summary className="cursor-pointer">Follow-up and copy workflow</summary>
            <form className="mt-2 grid gap-2" onSubmit={(event) => {
              const get = values(event);
              if (window.confirm("Create this follow-up task?")) save({ operation: "follow_up", id: item.id, confirmed: true,
                input: { title: get("title"), due: get("due") || null, status: "open" } });
            }}>
              <Field name="title" label="Follow-up title" /><Field name="due" label="Follow-up due date" type="date" required={false} />
              <Button disabled={busy} className="justify-self-start">Add confirmed follow-up</Button>
            </form>
            <form className="mt-3 grid gap-2" onSubmit={(event) => {
              const get = values(event);
              propose({ step: "copy", source: item.id, number: get("number"), issued: get("issued"), due: get("due") });
            }}>
              <Field name="number" label="New invoice number" /><Field name="issued" label="New issue date" type="date" /><Field name="due" label="New due date" type="date" />
              <Button disabled={busy} className="justify-self-start">Propose invoice copy</Button>
            </form>
          </details>}
        </article>)}
      </section>
      <section className={panel}>
        <h2 className="text-xl font-semibold">Invoice workflows</h2>
        {approval && <article className="grid gap-2 rounded border border-[var(--line)] p-3">
          <h3>Approval · {approval.status}</h3><pre className="whitespace-pre-wrap wrap-anywhere text-sm">{JSON.stringify(approval.plan, null, 2)}</pre>
          {approval.outcome?.message && <p>{approval.outcome.message}</p>}
          {approval.status === "pending" && <Button disabled={busy} className="justify-self-start" onClick={() => void run(async () => {
            setApproval(await request<Approval>("/api/agent/approvals/" + approval.id, { hash: approval.hash }));
          })}>Approve this workflow step</Button>}
        </article>}
        {!data.workflows.length && <p>No workflows yet.</p>}
        {data.workflows.map((item) => <article key={item.id} className="grid gap-2 border-t border-[var(--line)] pt-3">
          <p>{data.invoices.find((invoice) => invoice.id === item.sourceInvoice)?.number ?? item.sourceInvoice} · {item.stage.replaceAll("_", " ")}</p>
          {item.stage === "awaiting_copy" && <Link className="underline" href="/assistant">Review pending approvals</Link>}
          {item.stage === "copied" && <form className="grid gap-2" onSubmit={(event) => {
            event.preventDefault(); propose({ step: "draft", workflow: item.id, useWriter: true });
          }}>
            <label className="flex gap-2"><input type="checkbox" required />Send verified invoice fields to the configured writer for a draft. No email will be sent.</label>
            <Button disabled={busy} className="justify-self-start">Propose writer draft</Button>
          </form>}
          {item.emailDraft && <p className="whitespace-pre-wrap wrap-anywhere">{item.emailDraft}</p>}
          {item.stage === "drafted" && <form className="grid gap-2" onSubmit={(event) => {
            const get = values(event); propose({ step: "follow_up", workflow: item.id, title: get("title"), due: get("due") || null });
          }}>
            <Field name="title" label="Workflow follow-up title" /><Field name="due" label="Workflow follow-up date" type="date" required={false} />
            <Button disabled={busy} className="justify-self-start">Propose workflow follow-up</Button>
          </form>}
        </article>)}
      </section>
      <section className={panel}>
        <h2 className="text-xl font-semibold">Expenses</h2><Reports report="expenses" />
        <form className="grid gap-3" onSubmit={(event) => {
          const get = values(event); save({ operation: "expense_create", input: { description: get("description"), incurred: get("incurred"),
            amount: get("amount"), currency: get("currency") } });
        }}>
          <div className="grid gap-2 sm:grid-cols-2"><Field name="description" label="Expense description" />
            <Field name="incurred" label="Incurred date" type="date" /><Field name="amount" label="Expense amount" /><Field name="currency" label="Expense currency" /></div>
          <Button disabled={busy} className="justify-self-start">Add expense</Button>
        </form>
        {data.expenses.map((entry) => <p key={entry.id} className="wrap-anywhere">{entry.incurred} · {entry.description} · {entry.currency} {entry.amount}</p>)}
      </section>
    </>}
  </>;
}
