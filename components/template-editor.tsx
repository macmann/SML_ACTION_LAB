"use client";

import { useState } from "react";
import { Button } from "./ui/button";

type Preview = { preview: { part?: string; paragraph?: number; before: string; after: string }[]; previewHash: string };
type Approval = { id: string; hash: string; status: string; outcome?: { document?: { id: string }; message?: string } };
const input = "w-full min-w-0 rounded-md border border-[var(--line)] bg-[var(--page)] p-2";

async function post<T>(url: string, value: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "The template request failed.");
  return body;
}

export function TemplateEditor({ id, docx }: { id: string; docx: boolean }) {
  const [mode, setMode] = useState(docx ? "template" : "invoice_pdf");
  const [format, setFormat] = useState("docx");
  const [replacements, setReplacements] = useState([{ find: "", replace: "", count: 1 }]);
  const [preview, setPreview] = useState<Preview>();
  const [snapshot, setSnapshot] = useState<unknown>();
  const [approval, setApproval] = useState<Approval>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const endpoint = "/api/documents/" + id + "/template";
  const invoiceMode = mode !== "template";

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await action(); } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  return <details className="grid gap-4 rounded-lg border border-[var(--line)] p-3">
    <summary className="cursor-pointer font-semibold">Edit a version or draft an invoice</summary>
    <form className="mt-4 grid gap-3" onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const get = (key: string) => String(fields.get(key) ?? "").trim();
      const payload = {
        output: mode === "invoice_pdf" ? "pdf" : format,
        replacements: mode === "invoice_pdf" ? [] : replacements.filter((item) => item.find),
        ...(invoiceMode ? { invoice: { number: get("number"), date: get("date"), dueDate: get("dueDate"),
          period: get("period"), termsDays: Number(get("termsDays")) } } : {}),
        ...(mode === "invoice_pdf" ? { invoicePdf: { customer: get("customer"), description: get("description"),
          amount: get("amount"), currency: get("currency"), ...(get("tax") ? { tax: get("tax") } : {}) } } : {}),
      };
      setPreview(undefined);
      setApproval(undefined);
      void run(async () => {
        setPreview(await post<Preview>(endpoint, { input: payload, propose: false }));
        setSnapshot(payload);
      });
    }}>
      <label className="grid gap-1">Document operation
        <select className={input} value={mode} onChange={(event) => setMode(event.target.value)}>
          {docx && <><option value="template">Literal DOCX edit</option><option value="invoice_template">Fill invoice DOCX template</option></>}
          <option value="invoice_pdf">Create new PDF invoice draft</option>
        </select>
      </label>
      {mode !== "invoice_pdf" && <>
        <label className="grid gap-1">Output format
          <select className={input} value={format} onChange={(event) => setFormat(event.target.value)}>
            <option value="docx">DOCX</option><option value="pdf">PDF via isolated LibreOffice</option>
          </select>
        </label>
        {replacements.map((item, index) => <fieldset key={index} className="grid gap-2 sm:grid-cols-3">
          <legend>Replacement {index + 1}</legend>
          {(["find", "replace", "count"] as const).map((field) => <label key={field} className="grid gap-1">
            {{ find: "Find literal", replace: "Replace with", count: "Expected count" }[field]}
            <input className={input} type={field === "count" ? "number" : "text"} min={1} max={30}
              maxLength={field === "find" ? 120 : 200} value={item[field]} onChange={(event) =>
                setReplacements((items) => items.map((old, i) => i === index ?
                  { ...old, [field]: field === "count" ? Number(event.target.value) : event.target.value } : old))} />
          </label>)}
        </fieldset>)}
        <Button type="button" variant="outline" className="justify-self-start" disabled={replacements.length >= (invoiceMode ? 7 : 12)}
          onClick={() => setReplacements((items) => [...items, { find: "", replace: "", count: 1 }])}>Add replacement</Button>
      </>}
      {invoiceMode && <>
        {mode === "invoice_template" && <p className="text-sm">Use the invoice_number, invoice_date, due_date, period, and payment_terms placeholders in double braces.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["number", "Invoice number", "text"], ["date", "Invoice date", "date"],
            ["dueDate", "Due date", "date"], ["period", "Invoice period (YYYY-MM)", "text"],
            ["termsDays", "Payment terms (days)", "number"],
            ...(mode === "invoice_pdf" ? [["customer", "Customer", "text"], ["description", "Description", "text"],
              ["amount", "Amount", "text"], ["currency", "Currency code", "text"], ["tax", "Tax (optional)", "text"]] : []),
          ].map(([name, label, type]) => <label key={name} className="grid gap-1">{label}
            <input className={input} name={name} type={type} min={0} max={365} maxLength={120} required={name !== "tax"} />
          </label>)}
        </div>
      </>}
      <Button disabled={busy} className="justify-self-start">{busy ? "Working…" : "Preview changes"}</Button>
    </form>
    {error && <p role="alert" className="mt-2">{error}</p>}
    {preview && <section className="mt-4 grid gap-3" aria-label="Template change preview">
      <h3 className="font-semibold">Before and after</h3>
      {preview.preview.map((change, index) => <div key={index} className="border-t border-[var(--line)] pt-2">
        {change.part && <p className="font-medium">{change.part} · paragraph {change.paragraph}</p>}
        {change.before && <p className="whitespace-pre-wrap wrap-anywhere">Before: {change.before}</p>}
        <p className="whitespace-pre-wrap wrap-anywhere">After: {change.after}</p>
      </div>)}
      {!approval && <Button disabled={busy} className="justify-self-start" onClick={() => void run(async () => {
        const result = await post<{ approval: Approval }>(endpoint, { input: snapshot, propose: true, previewHash: preview.previewHash });
        setApproval(result.approval);
      })}>Request approval for this preview</Button>}
      {approval?.status === "pending" && <Button disabled={busy} className="justify-self-start" onClick={() => void run(async () => {
        setApproval(await post<Approval>("/api/agent/approvals/" + approval.id, { hash: approval.hash }));
      })}>Approve and save new version</Button>}
      {approval && <p role="status">{approval.outcome?.message ?? approval.status}</p>}
      {approval?.outcome?.document && <a className="underline" href={"/api/documents/" + approval.outcome.document.id + "/download"}>Download the new version</a>}
    </section>}
  </details>;
}
