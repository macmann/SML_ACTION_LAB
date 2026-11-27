import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { store } from "./bootstrap.mjs";
import { withDatabase, workspaceId, WorkspaceError } from "./database";
import { cleanupOriginals, readOriginal, removeOriginal, writeOriginal } from "./document-files";
import { DocumentIndex, type Metadata, type SearchRow } from "./document-search";
import { DocumentError, fileType, mediaTypes } from "./extraction";
import { extractIsolated } from "./document-worker";
import { defaultPreferences, settingsFrom } from "./settings";

const maximum = { documents: 1500, sections: 12000, characters: 4_000_000, files: 2 * 1024 ** 3 };
const select = `d.id, d.filename, d.title, d.tags, d.uploaded_at AS "uploadedAt",
  d.document_date::text AS "documentDate", d.media_type AS "mediaType",
  d.size_bytes AS size, d.extraction_status AS extraction`;
type Row = Omit<Metadata, "uploadedAt"> & { uploadedAt: Date; ordinal: number | null; reference: string | null; text: string | null };

function toEntry(row: Row): SearchRow {
  const { ordinal, reference, text, ...metadata } = row;
  return { metadata: { ...metadata, uploadedAt: metadata.uploadedAt.toISOString() },
    ordinal: ordinal ?? -1, reference: reference ?? "", text: text ?? "" };
}

type Workspace = { namespace: string; generation: number; index: DocumentIndex; size: number; reconciledAt: number };
const globalState = globalThis as typeof globalThis & { slmDocuments?: Workspace };

async function reconcile(workspace: Workspace) {
  const valid = new Set(workspace.index.documents.keys());
  for (const storage of ["files", "artifacts"] as const) {
    await cleanupOriginals(workspace.namespace, valid, storage).catch(() => {});
  }
  workspace.reconciledAt = Date.now();
}

async function initialized(pool: pg.Pool, generation: number) {
  const namespace = await workspaceId(pool);
  const previous = globalState.slmDocuments;
  if (previous?.namespace === namespace && previous.generation === generation) {
    if (Date.now() - previous.reconciledAt > 60 * 60 * 1000) await reconcile(previous);
    return previous;
  }
  const { rows } = await pool.query<Row>(`SELECT ${select}, a.document_id IS NOT NULL AS attached,
    c.ordinal, c.reference, c.body AS text FROM slm_workspace.documents d
    LEFT JOIN slm_workspace.document_contents c ON c.document_id = d.id
    LEFT JOIN slm_workspace.active_attachments a ON a.document_id = d.id
    ORDER BY d.id, c.ordinal LIMIT $1`, [maximum.sections + 1]);
  const index = new DocumentIndex();
  let chars = 0;
  for (const row of rows) chars += row.text?.length ?? 0;
  if (rows.length > maximum.sections || chars > maximum.characters) {
    throw new WorkspaceError("The workspace exceeds the local index capacity.", 503);
  }
  index.add(rows.map(toEntry));
  const size = [...index.documents.values()].reduce((sum, doc) => sum + doc.size, 0);
  const rebuilt = { namespace, generation, index, size, reconciledAt: 0 };
  await reconcile(rebuilt);
  globalState.slmDocuments = rebuilt;
  return rebuilt;
}

function useDocuments<T>(run: (workspace: Workspace, pool: pg.Pool) => Promise<T>) {
  return withDatabase(async (pool, generation) => run(await initialized(pool, generation), pool));
}

function metadataFor(workspace: Workspace, id: string) {
  const metadata = workspace.index.documents.get(id);
  if (!metadata) throw new WorkspaceError("Document not found.", 404);
  return metadata;
}

async function readBody(request: Request, max: number) {
  const declared = Number(request.headers.get("content-length"));
  if (declared > max) throw new WorkspaceError("The file exceeds the configured upload limit.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new WorkspaceError("The file is empty.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = AbortSignal.timeout(60_000);
  const canceled = () => { void reader.cancel().catch(() => {}); };
  abort.addEventListener("abort", canceled, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) throw new WorkspaceError("The file exceeds the configured upload limit.", 413);
      chunks.push(value);
    }
  } finally {
    abort.removeEventListener("abort", canceled);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (abort.aborted || request.signal.aborted) throw new WorkspaceError("The upload was interrupted.", 408);
  if (declared > 0 && declared !== length) throw new WorkspaceError("The uploaded file was incomplete.");
  if (!length) throw new WorkspaceError("The file is empty.");
  return Buffer.concat(chunks, length);
}

export function uploadDocument(request: Request, metadata: { filename: string; title: string; tags: string[]; documentDate: string | null }) {
  return useDocuments(async (workspace, pool) => {
    const { namespace, index } = workspace;
    if (index.documents.size >= maximum.documents) throw new WorkspaceError("The workspace document limit has been reached.", 413);
    const limit = (settingsFrom(await store.load()).preferences?.uploadMiB ?? defaultPreferences.uploadMiB) * 1024 ** 2;
    const safeMemoryLimit = Math.min(limit, 64 * 1024 ** 2);
    let bytes: Buffer;
    let format;
    let sections;
    try {
      format = fileType(metadata.filename, request.headers.get("content-type") ?? "");
      bytes = await readBody(request, safeMemoryLimit);
      if (workspace.size + bytes.length > maximum.files) throw new WorkspaceError("The workspace storage limit has been reached.", 413);
      sections = await extractIsolated(bytes, format);
    } catch (error) {
      if (error instanceof DocumentError) throw new WorkspaceError(error.message, 422);
      throw error;
    }
    if (index.records.size + Math.max(1, sections.length) > maximum.sections ||
        index.characters + sections.reduce((n, section) => n + section.text.length, 0) > maximum.characters) {
      throw new WorkspaceError("The workspace index capacity has been reached.", 413);
    }
    const id = randomUUID();
    const uploadedAt = new Date();
    const mediaType = mediaTypes[format];
    const extraction = sections.length ? "extracted" : "no_text";
    const client = await pool.connect();
    let commitStarted = false;
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO slm_workspace.documents
        (id, filename, title, tags, document_date, uploaded_at, media_type, size_bytes, extraction_status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, metadata.filename, metadata.title, metadata.tags, metadata.documentDate, uploadedAt, mediaType, bytes.length, extraction]);
      if (sections.length) {
        await client.query(`INSERT INTO slm_workspace.document_contents (document_id, ordinal, reference, body)
          SELECT $1::uuid, (n - 1)::int, reference, body
          FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS s(reference, body, n)`,
          [id, sections.map((section) => section.reference), sections.map((section) => section.text)]);
      }
      await client.query("INSERT INTO slm_workspace.document_versions (document_id, version, sha256) VALUES ($1, 1, $2)",
        [id, createHash("sha256").update(bytes).digest("hex")]);
      await writeOriginal(namespace, id, bytes);
      await writeOriginal(namespace, id, Buffer.from(JSON.stringify({ extraction, sections })), "artifacts");
      commitStarted = true;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      // If commit acknowledgement is lost, reconcile the original using committed database rows.
      if (!commitStarted) await removeDocumentFiles(namespace, id);
      globalState.slmDocuments = undefined;
      throw error;
    } finally {
      client.release();
    }
    const document = { ...metadata, id, uploadedAt: uploadedAt.toISOString(), mediaType,
      size: bytes.length, extraction, attached: false } satisfies Metadata;
    index.add(sections.length ? sections.map((section, ordinal) => ({ metadata: document, ...section, ordinal }))
      : [{ metadata: document, ordinal: -1, reference: "", text: "" }]);
    workspace.size += bytes.length;
    return document;
  });
}

export function listDocuments(options: Parameters<DocumentIndex["find"]>[0]) {
  return useDocuments(async ({ index }) => ({
    ...index.find(options),
    attachments: [...index.documents.values()].filter((document) => document.attached).map(({ id, title }) => ({ id, title })),
  }));
}

export function previewDocument(id: string) {
  return useDocuments(async (workspace, pool) => {
    const metadata = metadataFor(workspace, id);
    const { rows: sections } = await pool.query<{ reference: string; text: string }>(
      "SELECT reference, body AS text FROM slm_workspace.document_contents WHERE document_id = $1 ORDER BY ordinal", [id]);
    return { ...metadata, sections };
  });
}

export function downloadDocument(id: string) {
  return useDocuments(async (workspace) => {
    const { filename } = metadataFor(workspace, id);
    const { file, size } = await readOriginal(workspace.namespace, id).catch(() => {
      throw new WorkspaceError("The stored original is unavailable.", 404);
    });
    return { filename, file, size };
  });
}

async function removeDocumentFiles(namespace: string, id: string) {
  for (const storage of ["files", "artifacts"] as const) {
    await removeOriginal(namespace, id, storage).catch(() => {});
  }
}

export function deleteDocument(id: string) {
  return useDocuments(async (workspace, pool) => {
    const metadata = metadataFor(workspace, id);
    try {
      await pool.query("DELETE FROM slm_workspace.documents WHERE id = $1", [id]);
    } catch (error) {
      globalState.slmDocuments = undefined;
      throw error;
    }
    workspace.index.delete(id);
    workspace.size -= metadata.size;
    await removeDocumentFiles(workspace.namespace, id);
  });
}

export function attachDocument(id: string, attached: boolean) {
  return useDocuments(async ({ index }, pool) => {
    const metadata = index.documents.get(id);
    if (!metadata) throw new WorkspaceError("Document not found.", 404);
    if (attached && !metadata.attached && [...index.documents.values()].filter((doc) => doc.attached).length >= 30) {
      throw new WorkspaceError("Up to 30 documents can be active attachments.");
    }
    try {
      await pool.query(attached ? "INSERT INTO slm_workspace.active_attachments VALUES ($1) ON CONFLICT DO NOTHING" :
        "DELETE FROM slm_workspace.active_attachments WHERE document_id = $1", [id]);
    } catch (error) {
      globalState.slmDocuments = undefined;
      throw error;
    }
    metadata.attached = attached;
  });
}
