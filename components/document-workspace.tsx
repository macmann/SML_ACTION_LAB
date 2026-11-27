"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Metadata } from "@/lib/document-search";
import { Button } from "@/components/ui/button";

type Result = Metadata & { reference?: string; snippet?: string };
type Listing = { total: number; results: Result[]; attachments: { id: string; title: string }[] };
type Preview = Metadata & { sections: { reference: string; text: string }[] };
const fields = "min-h-10 min-w-0 w-full rounded-md border border-[var(--line)] bg-[var(--page)] px-3 py-2";
const panel = "min-w-0 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-6";
const types = [
  ["PDF", "application/pdf"], ["DOCX", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["TXT", "text/plain"], ["XLSX", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], ["CSV", "text/csv"],
];

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (response.status === 204) return;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "The workspace request failed.");
  return body;
}

export function DocumentWorkspace({ maxMiB }: { maxMiB: number }) {
  const [parameters, setParameters] = useState("");
  const [reload, setReload] = useState(0);
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const previewRequest = useRef<AbortController | null>(null);
  const [tags, setTags] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [title, setTitle] = useState("");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    request("/api/documents?" + parameters, { signal: controller.signal })
      .then(setListing).catch((failure) => {
        if (!controller.signal.aborted) { setError(failure.message); setListing(null); }
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [parameters, reload]);

  useEffect(() => () => previewRequest.current?.abort(), []);

  function refresh() {
    setLoading(true);
    setError("");
    setReload((count) => count + 1);
  }

  async function show(id: string) {
    previewRequest.current?.abort();
    const controller = new AbortController();
    previewRequest.current = controller;
    setPreview(null);
    setPreviewLoading(true);
    setError("");
    try { setPreview(await request("/api/documents/" + id, { signal: controller.signal })); }
    catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); }
    finally { if (!controller.signal.aborted) setPreviewLoading(false); }
  }

  async function upload(files: File[]) {
    if (!files.length || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice([]);
    const messages: string[] = [];
    try {
      for (const file of files.slice(0, 20)) {
        try {
          if (file.size > maxMiB * 1024 ** 2) throw new Error("Exceeds the upload size limit.");
          const metadata = { filename: file.name, title: files.length === 1 ? title : undefined,
            tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), documentDate: documentDate || undefined };
          await request("/api/documents", {
            method: "POST", body: file,
            headers: { "Content-Type": file.type || "application/octet-stream", "Slm-Upload": encodeURIComponent(JSON.stringify(metadata)) },
          });
          messages.push("Uploaded " + file.name);
        } catch (failure) { messages.push(file.name + " — " + (failure as Error).message); }
      }
      if (files.length > 20) messages.push("The remaining files were omitted. Upload up to 20 at a time.");
    } finally {
      busyRef.current = false;
      setBusy(false);
      setNotice(messages);
      refresh();
    }
  }

  async function change(id: string, method: "DELETE" | "PATCH", attached?: boolean) {
    if (busyRef.current || (method === "DELETE" && !window.confirm("Permanently delete this document and its extracted text?"))) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await request("/api/documents/" + id, {
        method, headers: method === "PATCH" ? { "Slm-Attachment": String(attached) } : undefined,
      });
      if (preview?.id === id) {
        if (method === "DELETE") setPreview(null);
        else setPreview({ ...preview, attached: Boolean(attached) });
      }
      refresh();
    } catch (failure) { setError((failure as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Documents</h1>
      <section className={panel} aria-labelledby="upload-heading">
        <h2 id="upload-heading" className="mb-3 text-xl font-semibold">Upload documents</h2>
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1">Title for a single file
            <input className={fields} value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="grid gap-1">Tags, comma separated
            <input className={fields} value={tags} maxLength={500} onChange={(e) => setTags(e.target.value)} />
          </label>
          <label className="grid gap-1">Document date
            <input className={fields} type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
          </label>
        </div>
        <label className={"grid min-w-0 gap-2 rounded-lg border border-dashed p-4 " + (dragging ? "bg-[var(--selected)]" : "border-[var(--line)]")}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); void upload([...event.dataTransfer.files]); }}>
          <span>Drop files here or choose files</span>
          <input className="min-w-0 max-w-full" type="file" multiple accept=".pdf,.docx,.txt,.xlsx,.csv" disabled={busy}
            onChange={(event) => { void upload([...(event.target.files ?? [])]); event.target.value = ""; }} />
          <span className="text-sm text-[var(--muted)]">PDF, DOCX, TXT, XLSX, CSV · up to {maxMiB} MiB each</span>
        </label>
        {busy && <p role="status" className="mt-3">Working…</p>}
        {notice.length > 0 && <ul role="status" className="mt-3 list-inside list-disc wrap-anywhere text-sm">
          {notice.map((item, index) => <li key={index}>{item}</li>)}
        </ul>}
      </section>

      <section className={panel} aria-labelledby="search-heading">
        <h2 id="search-heading" className="mb-3 text-xl font-semibold">Search workspace</h2>
        <form className="grid gap-3" onSubmit={(event) => {
          event.preventDefault();
          const next = new URLSearchParams();
          for (const [name, value] of new FormData(event.currentTarget)) if (typeof value === "string" && value) next.set(name, value);
          if (next.toString() !== parameters) { setLoading(true); setError(""); setParameters(next.toString()); }
          else refresh();
        }}>
          <label className="grid gap-1">Search terms
            <input className={fields} type="search" name="q" maxLength={160} placeholder="Title, content, tag or exact identifier" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="grid gap-1">Tag<input className={fields} name="tag" maxLength={40} /></label>
            <label className="grid gap-1">File type<select className={fields} name="type">
              <option value="">All types</option>{types.map(([label, value]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label className="grid gap-1">Filter dates by<select className={fields} name="dateField">
              <option value="uploaded">Upload date (UTC)</option><option value="document">Document date</option>
            </select></label>
            <label className="grid gap-1">From<input className={fields} name="from" type="date" /></label>
            <label className="grid gap-1">Through<input className={fields} name="to" type="date" /></label>
            <label className="grid gap-1">Sort by<select className={fields} name="sort">
              <option value="relevance">Relevance</option><option value="uploaded-desc">Upload date · newest</option>
              <option value="uploaded-asc">Upload date · oldest</option><option value="document-desc">Document date · newest</option>
              <option value="document-asc">Document date · oldest</option>
            </select></label>
          </div>
          <Button className="justify-self-start">Search</Button>
        </form>
      </section>

      {error && <p role="alert" className="wrap-anywhere text-[var(--error)]">{error}{" "}
        <Link href="/settings" className="underline">Open Settings</Link></p>}
      {loading && <p role="status">Loading documents…</p>}
      {listing && (
        <>
          <section className={panel} aria-labelledby="attachments-heading">
            <h2 id="attachments-heading" className="mb-2 text-xl font-semibold">Active attachments</h2>
            {listing.attachments.length ? (
              <ul className="grid gap-2">{listing.attachments.map(({ id, title }) => (
                <li key={id} className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" className="h-auto max-w-full whitespace-normal wrap-anywhere text-left" onClick={() => void show(id)}>{title}</Button>
                  <Button variant="outline" disabled={busy} onClick={() => void change(id, "PATCH", false)}>Detach</Button>
                </li>
              ))}</ul>
            ) : <p className="text-[var(--muted)]">No active attachments.</p>}
          </section>
          <section aria-labelledby="results-heading">
            <h2 id="results-heading" className="mb-3 text-xl font-semibold">Documents ({listing.total})</h2>
            {listing.total > listing.results.length && <p className="mb-3">Showing the first {listing.results.length}. Refine the search to see other results.</p>}
            {!listing.results.length && <p className="text-[var(--muted)]">No documents match this search.</p>}
            <ul className="grid gap-3">{listing.results.map((document) => (
              <li key={document.id} className={panel + " grid gap-2 wrap-anywhere"}>
                <div><h3 className="font-semibold">{document.title}</h3><p className="text-sm text-[var(--muted)]">{document.filename}</p></div>
                <p className="text-sm text-[var(--muted)]">Uploaded {document.uploadedAt.slice(0, 10)} (UTC) · Document date {document.documentDate ?? "not set"}</p>
                {document.tags.length > 0 && <p className="text-sm">{document.tags.join(", ")}</p>}
                {document.reference && <p className="text-sm font-medium">{document.reference}</p>}
                {document.snippet && <p className="text-sm">{document.snippet}</p>}
                {document.extraction === "no_text" && <p className="text-sm">No extractable text.</p>}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void show(document.id)}>Preview</Button>
                  <a className="self-center p-2 underline" href={"/api/documents/" + document.id + "/download"}>Download</a>
                  <Button variant="outline" disabled={busy} onClick={() => void change(document.id, "PATCH", !document.attached)}>{document.attached ? "Detach" : "Attach"}</Button>
                  <Button variant="outline" disabled={busy} onClick={() => void change(document.id, "DELETE")}>Delete</Button>
                </div>
              </li>
            ))}</ul>
          </section>
        </>
      )}
      {previewLoading && <p role="status">Loading preview…</p>}
      {preview && <section className={panel + " grid gap-3 wrap-anywhere"} aria-label="Extracted text preview">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-xl font-semibold">{preview.title}</h2>
          <Button variant="outline" onClick={() => setPreview(null)}>Close preview</Button>
        </div>
        {preview.sections.length ? preview.sections.map(({ reference, text }, index) => (
          <div key={index} className="border-t border-[var(--line)] pt-2">
            <h3 className="font-semibold">{reference}</h3><p className="whitespace-pre-wrap">{text}</p>
          </div>
        )) : <p>No extractable text. Scanned PDFs require OCR, which is unavailable.</p>}
      </section>}
    </>
  );
}
