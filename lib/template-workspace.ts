import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { dataRoot } from "./data.mjs";
import { join } from "node:path";
import { metadataFor, prepareDocument, insertDocument, type Workspace } from "./documents";
import { readOriginal } from "./document-files";
import { editDocx } from "./docx-template";
import { convertOffice } from "./office-conversion.mjs";
import { mediaTypes, officeArchive, DocumentError, type Section } from "./extraction";
import { extractIsolated } from "./document-worker";
import { WorkspaceError } from "./database";
import PDFDocument from "pdfkit";

const compact = z.string().trim().min(1).max(120).refine((value) => !/[\p{Cc}]/u.test(value));
export const replacementSchema = z.strictObject({
  find: compact, replace: z.string().max(200).refine((value) => !/[\p{Cc}]/u.test(value)), count: z.number().int().min(1).max(30),
});
const date = z.iso.date();
export const invoiceSchema = z.strictObject({
  number: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9./_-]{0,59}$/),
  date, dueDate: date, period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  termsDays: z.number().int().min(0).max(365),
}).refine((data) => {
  const start = Date.parse(data.date + "T00:00:00Z");
  const due = Date.parse(data.dueDate + "T00:00:00Z");
  return !data.period.startsWith("0000") && !data.date.startsWith("0000") && due - start === data.termsDays * 86_400_000;
}, "The due date must agree with the explicit payment terms.");
export const invoicePdfSchema = z.strictObject({
  customer: compact, description: compact,
  amount: z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  tax: z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/).optional(),
});
export const templateInput = z.strictObject({
  output: z.enum(["docx", "pdf"]), replacements: z.array(replacementSchema).max(12), invoice: invoiceSchema.optional(),
  invoicePdf: invoicePdfSchema.optional(),
}).refine((value) => value.invoicePdf
  ? value.output === "pdf" && Boolean(value.invoice) && !value.replacements.length
  : value.replacements.length + (value.invoice ? 5 : 0) > 0 && value.replacements.length + (value.invoice ? 5 : 0) <= 12);
export const templatePlanSchema = z.strictObject({
  tool: z.literal("edit_document_template"), sourceId: z.uuid(), sourceTitle: z.string().min(1).max(180),
  originalHash: z.string().regex(/^[a-f0-9]{64}$/), input: templateInput,
});
export type TemplatePlan = z.infer<typeof templatePlanSchema>;

const invoiceKeys = ["invoice_number", "invoice_date", "due_date", "period", "payment_terms"] as const;
export const checksum = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function originalBytes(workspace: Workspace, id: string) {
  const opened = await readOriginal(workspace.namespace, id);
  try {
    if (opened.size > 12 * 1024 ** 2) throw new WorkspaceError("Editing is limited to 12 MiB originals.", 413);
    return await opened.file.readFile();
  } finally { await opened.file.close(); }
}

async function assemble(workspace: Workspace, sourceId: string, input: z.infer<typeof templateInput>) {
  const document = metadataFor(workspace, sourceId);
  const original = await originalBytes(workspace, sourceId);
  const originalHash = checksum(original);
  if (input.invoicePdf) {
    const invoice = input.invoice!;
    const { customer, description, amount, currency, tax } = input.invoicePdf;
    const content = [
      "DRAFT INVOICE", "Invoice number: " + invoice.number, "Invoice date: " + invoice.date,
      "Due date: " + invoice.dueDate, "Period: " + invoice.period, "Payment terms: " + invoice.termsDays + " days",
      "Customer: " + customer, "Description: " + description, "Amount: " + amount, "Currency: " + currency,
      ...(tax === undefined ? [] : ["Tax: " + tax]),
    ].join("\n");
    if (/[^\x0A\x20-\x7E]/.test(content)) throw new WorkspaceError("PDF invoice drafts require ASCII text.");
    return { document, originalHash, content };
  }
  if (document.mediaType !== mediaTypes.docx) throw new WorkspaceError("Template editing requires a stored DOCX file.");
  const invoice = input.invoice;
  const inferred = invoice ? [invoice.number, invoice.date, invoice.dueDate, invoice.period, invoice.termsDays + " days"] : [];
  const replacements = [...input.replacements, ...invoiceKeys.slice(0, inferred.length).map((key, index) =>
    ({ find: "{{" + key + "}}", replace: inferred[index], count: 1 }))];
  let edit;
  try {
    edit = await editDocx(original, replacements, Boolean(invoice));
  } catch (error) {
    if (error instanceof DocumentError) throw new WorkspaceError(error.message, 422);
    throw error;
  }
  return { document, originalHash, edit };
}

export async function buildTemplatePlan(workspace: Workspace, pool: pg.Pool, id: string, input: z.infer<typeof templateInput>) {
  if (input.invoice && (await pool.query("SELECT 1 FROM slm_workspace.invoices WHERE lower(invoice_number)=lower($1) UNION ALL SELECT 1 FROM slm_workspace.template_invoice_numbers WHERE number=lower($1)", [input.invoice.number])).rowCount) {
    throw new WorkspaceError("The invoice number is already registered.", 409);
  }
  const result = await assemble(workspace, id, input);
  const plan: TemplatePlan = { tool: "edit_document_template", sourceId: id,
    sourceTitle: result.document.title, originalHash: result.originalHash, input };
  return { plan, preview: result.edit?.changes ?? [{ before: "", after: result.content }] };
}

async function invoicePDF(content: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({ margin: 48 });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk) => chunks.push(chunk));
    pdf.once("error", reject);
    pdf.once("end", () => resolve(Buffer.concat(chunks)));
    pdf.fontSize(12).text(content);
    pdf.end();
  });
}

export async function executeTemplate(workspace: Workspace, client: pg.PoolClient, id: string, plan: TemplatePlan) {
  const result = await assemble(workspace, plan.sourceId, plan.input);
  if (result.originalHash !== plan.originalHash) throw new WorkspaceError("The original hash changed. Create a new preview.", 409);
  const { invoice, invoicePdf, output } = plan.input;
  if (invoice) {
    // Serializes case-insensitive registration across app processes as well as the local DB lane.
    await client.query("SELECT pg_advisory_xact_lock(1936485681, 841306)");
    if ((await client.query("SELECT 1 FROM slm_workspace.invoices WHERE lower(invoice_number)=lower($1) UNION ALL SELECT 1 FROM slm_workspace.template_invoice_numbers WHERE number=lower($1)", [invoice.number])).rowCount) {
      throw new WorkspaceError("The invoice number is already registered.", 409);
    }
    // The legacy invoices table requires a currency. Store document templates in the separate registry
    // so an unspecified currency is never fabricated.
    await client.query("INSERT INTO slm_workspace.template_invoice_numbers (number) VALUES (lower($1))", [invoice.number])
      .catch((error) => { if (error.code === "23505") throw new WorkspaceError("The invoice number is already registered.", 409); throw error; });
    if (invoicePdf) await client.query("INSERT INTO slm_workspace.invoices (id,invoice_number,currency,issued_on) VALUES ($1,$2,$3,$4)",
      [id, invoice.number, invoicePdf.currency, invoice.date]);
  }
  let bytes: Buffer;
  try {
    bytes = result.content ? await invoicePDF(result.content) : output === "docx" ? result.edit!.bytes :
      await convertOffice(result.edit!.bytes, join(dataRoot, "tmp"));
  } catch (error) {
    throw new WorkspaceError(error instanceof Error ? error.message : "File generation failed.", 422);
  }
  if (output === "pdf" && !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new WorkspaceError("PDF verification failed.");
  return saveVersion(workspace, client, id, plan.sourceId, plan.originalHash, bytes, output,
    "Version · " + result.document.title, invoice?.date ?? null);
}

async function saveVersion(workspace: Workspace, client: pg.PoolClient, id: string, sourceId: string, originalHash: string,
  bytes: Buffer, output: "docx" | "pdf", title: string, date: string | null) {
  const sections: Section[] = await extractIsolated(bytes, output);
  const document = prepareDocument(workspace, id, {
    title: title.slice(0, 140), filename: "version-" + id + "." + output,
    tags: ["document-version"], documentDate: date,
  }, mediaTypes[output], bytes, sections);
  await insertDocument(client, workspace.namespace, document, bytes, sections);
  const { rows: [version] } = await client.query<{ version: number }>(`INSERT INTO slm_workspace.document_derivations
    (document_id,source_id,source_hash,version)
    SELECT $1,$2,$3,COALESCE(max(version),1)+1 FROM slm_workspace.document_derivations WHERE source_id=$2
    RETURNING version`, [id, sourceId, originalHash]);
  return { document: { id, title: document.title, filename: document.filename }, version: version.version, sourceHash: originalHash };
}

export async function copyDocxVersion(workspace: Workspace, client: pg.PoolClient, id: string,
  sourceId: string, title: string, period: string, sourceHash: string) {
  const original = await originalBytes(workspace, sourceId);
  if (checksum(original) !== sourceHash) throw new WorkspaceError("The original hash changed. Propose the copy again.", 409);
  await officeArchive(original);
  return saveVersion(workspace, client, id, sourceId, sourceHash, original, "docx", "Draft " + period + " · " + title, null);
}
