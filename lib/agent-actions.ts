import PDFDocument from "pdfkit";
import type pg from "pg";
import { documentSections, insertDocument, metadataFor, prepareDocument, type Workspace } from "./documents";
import { type Metadata } from "./document-search";
import { invoiceInput } from "./business-validation";
import { getInvoice } from "./business";
import { analyzeSpreadsheet } from "./spreadsheet";
import { mediaTypes, type Section } from "./extraction";
import { buildTemplatePlan, originalBytes, checksum, copyDocxVersion, type TemplatePlan } from "./template-workspace";
import { evidencedField } from "./evidence.mjs";
import { WorkspaceError } from "./database";
import { applyReplacements, taskTitles } from "./agent-rules.mjs";

type DateFilter = { field: "uploaded" | "document"; from?: string; to?: string };
type Filters = { file_type?: keyof typeof mediaTypes; date_filter?: DateFilter; tag?: string; task_status?: string };
type Replacements = { find: string; replace: string }[];
export type Args = Record<string, unknown>;
type Draft = { action: string; instruction: string; source: string; sourceId: string; sections?: Section[] };
type Source = { sourceId: string; sourceTitle: string };
export type Proposal = Source & (
  { tool: "duplicate_document"; targetPeriod: string; preserveAmount: true; preserveCustomer: true; originalHash?: string }
  | { tool: "create_tasks_from_document"; titles: string[]; evidence?: { reference: string; quote: string }[] }
  | { tool: "modify_and_convert"; replacements: Replacements; output: "txt" | "pdf" }
);
export type ActionResult = { result: unknown } | { draft: Draft } | { proposal: Proposal | TemplatePlan; preview?: unknown };

export class Clarification extends WorkspaceError {
  constructor(message: string) { super(message, 422); }
}

const baseSearch = { tag: "", mediaType: "", dateField: "uploaded", from: "", to: "", sort: "relevance" } as const;
const text = (args: Args, name: string) => typeof args[name] === "string" ? args[name].trim() : "";
const dateFilter = (args: Args) => args.date_filter as DateFilter | undefined;
const sourceText = (sections: Section[]) => sections.map((section) => section.text).join("\n\n");

function plainMetadata(document: Metadata) {
  const { id, title, filename, uploadedAt, documentDate, tags } = document;
  return { id, title, filename, uploadedAt, documentDate, tags };
}

function activeId(query: string, active: string[]) {
  if (!query.startsWith("@active")) return null;
  const selected = /^@active:([1-5])$/.exec(query);
  const id = selected ? active[Number(selected[1]) - 1] : query === "@active" && active.length === 1 ? active[0] : undefined;
  if (!id) throw new Clarification("Select one active document or specify an exact document reference.");
  return id;
}

function resolve(workspace: Workspace, query: string, active: string[]) {
  const identifier = activeId(query, active);
  if (identifier) return metadataFor(workspace, identifier);
  const name = query.normalize("NFC").toLowerCase();
  const exact = [...workspace.index.documents.values()].filter((doc) =>
    doc.id === name || doc.title.toLowerCase() === name || doc.filename.toLowerCase() === name);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Clarification("Multiple documents share that name. Select an active document or use a specific document ID.");
  const { total, results } = workspace.index.find({ ...baseSearch, query });
  if (total === 1) return metadataFor(workspace, results[0].id);
  throw new Clarification(total ? "Multiple documents match. Select an active document or give an exact filename." : "No document matches. Check the filename or select an active document.");
}

function search(workspace: Workspace, query: string, active: string[], filters: Filters = {}) {
  const date = filters.date_filter;
  const options = {
    ...baseSearch, query, tag: filters.tag ?? "", mediaType: filters.file_type ? mediaTypes[filters.file_type] : "",
    dateField: date?.field ?? baseSearch.dateField, from: date?.from ?? "", to: date?.to ?? "",
  };
  const id = activeId(query, active);
  if (id) {
    const doc = metadataFor(workspace, id);
    const actual = options.dateField === "document" ? doc.documentDate : doc.uploadedAt.slice(0, 10);
    const matches = (!options.mediaType || doc.mediaType === options.mediaType) &&
      (!(options.from || options.to) || Boolean(actual && (!options.from || actual >= options.from) && (!options.to || actual <= options.to)));
    return { total: matches ? 1 : 0, documents: matches ? [plainMetadata(doc)] : [] };
  }
  const { total, results } = workspace.index.find(options);
  return { total, documents: results.slice(0, 12).map((doc) => ({ ...plainMetadata(doc), reference: doc.reference, snippet: doc.snippet })) };
}

export function grounded(tool: string, args: Args, user: string) {
  const explicitNumbers = new Set(user.match(/[\p{L}\p{N}]+(?:[-_.:/][\p{L}\p{N}]+)*/gu)?.map((token) => token.toLowerCase()));
  for (const key of ["query", "source_query", "left_query", "right_query"]) {
    const query = text(args, key);
    if (query.startsWith("@active")) continue;
    const sensitive = query.match(/[\p{L}\p{N}]+(?:[-_.:/][\p{L}\p{N}]+)*/gu)?.filter((value) => /\d/.test(value)) ?? [];
    if (sensitive.some((token) => !explicitNumbers.has(token.toLowerCase()))) return false;
  }
  const filter = dateFilter(args) ?? (args.filters as Filters | undefined)?.date_filter;
  if ([filter?.from, filter?.to, text(args, "target_period")].some((part) => part && !explicitNumbers.has(part))) return false;
  if (tool === "modify_and_convert") {
    const replacements = args.replacements as Replacements;
    return replacements.every(({ find, replace }) => [find, replace].every((value) =>
      user.includes(JSON.stringify(value)) || (!value.includes("'") && user.includes("'" + value + "'"))));
  }
  return true;
}

export async function performAction(workspace: Workspace, pool: pg.Pool, tool: string, args: Args,
  active: string[]): Promise<ActionResult> {
  if (tool === "search_documents") return { result: search(workspace, text(args, "query"), active,
    { file_type: args.file_type as Filters["file_type"], date_filter: dateFilter(args) }) };
  if (tool === "generate_report") {
    const filters = (args.filters ?? {}) as Filters;
    if (args.report_type === "document_inventory" && !filters.task_status) return { result: search(workspace, "", active, filters) };
    if (args.report_type !== "task_status" || filters.tag || filters.file_type || filters.date_filter) {
      throw new Clarification("Use document filters for the inventory and task_status for the task report.");
    }
    const { rows } = await pool.query("SELECT status, count(*)::int AS total FROM slm_workspace.tasks WHERE ($1::text IS NULL OR status = $1) GROUP BY status ORDER BY status",
      [filters.task_status ?? null]);
    return { result: { tasks: rows, downloads: ["xlsx", "csv", "pdf"].map((format) =>
      "/api/business/reports?report=tasks&format=" + format + (filters.task_status ? "&status=" + filters.task_status : "")) } };
  }
  if (tool === "compare_documents") {
    const left = resolve(workspace, text(args, "left_query"), active);
    const right = resolve(workspace, text(args, "right_query"), active);
    if (left.id === right.id) throw new Clarification("Choose two different documents.");
    const leftSections = await documentSections(pool, left.id);
    const rightSections = await documentSections(pool, right.id);
    const a = new Set(leftSections.map((section) => section.text));
    const b = new Set(rightSections.map((section) => section.text));
    if (!a.size || !b.size) throw new Clarification("Both documents need extractable text for comparison.");
    const different = (from: Set<string>, to: Set<string>) => [...from].filter((section) => !to.has(section));
    const leftOnly = different(a, b);
    const rightOnly = different(b, a);
    return { result: { left: plainMetadata(left), right: plainMetadata(right),
      leftOnly: leftOnly.slice(0, 8).map((section) => section.slice(0, 220)), leftOnlyCount: leftOnly.length,
      rightOnly: rightOnly.slice(0, 8).map((section) => section.slice(0, 220)), rightOnlyCount: rightOnly.length,
      fields: ["invoice_id", "invoice_date", "due_date", "amount", "currency", "customer", "supplier", "reference"].flatMap((field) => {
        const before = evidencedField(leftSections, field);
        const after = evidencedField(rightSections, field);
        return before.status !== after.status || before.value !== after.value ? [{ field, before, after }] : [];
      }) } };
  }

  const selected = resolve(workspace, text(args, tool === "search_and_summarize" ? "query" : "source_query"), active);
  const source = { sourceId: selected.id, sourceTitle: selected.title };
  if (tool === "analyze_spreadsheet") {
    try {
      const analysis = await analyzeSpreadsheet(workspace, selected.id, {
        metric: text(args, "metric"), groupBy: text(args, "group_by") || undefined,
        operation: args.operation as "sum" | "count" | "average" | "min" | "max",
      });
      return { result: { source: plainMetadata(selected), ...analysis } };
    } catch (error) {
      if (error instanceof WorkspaceError) throw new Clarification(error.message);
      throw error;
    }
  }

  const sections = await documentSections(pool, selected.id);
  if (!sections.length) throw new Clarification("The selected document has no extractable text.");
  const body = sourceText(sections);
  if (tool === "extract_document_fields") return { result: { source: plainMetadata(selected),
    fields: Object.fromEntries((args.fields as string[]).map((key) => [key, evidencedField(sections, key)])) } };
  if (tool === "search_and_summarize" || tool === "draft_email") {
    const instruction = tool === "draft_email" ? JSON.stringify({ purpose: args.purpose, tone: args.tone }) :
      JSON.stringify({ focus: args.focus, summary_style: args.summary_style });
    let excerpt = body.slice(0, 8000);
    if (tool === "draft_email" && ["invoice_id", "amount"].some((key) => evidencedField(sections, key).status !== "missing")) {
      const { rows } = await pool.query<{ id: string }>("SELECT id FROM slm_workspace.invoices WHERE source_document=$1 AND verified LIMIT 2", [selected.id]);
      if (rows.length !== 1) throw new Clarification("Record and verify one invoice linked to this source before drafting an invoice email.");
      const invoice = await getInvoice(pool, rows[0].id);
      const data = invoiceInput.safeParse({ number: invoice.number, currency: invoice.currency, customer: invoice.customer,
        amount: invoice.amount, tax: invoice.tax, issued: invoice.issued, due: invoice.due, source: invoice.source });
      if (!data.success) throw new Clarification("The verified invoice is missing required billing details.");
      excerpt = JSON.stringify({ ...data.data, source: undefined, total: invoice.total, status: invoice.status });
    }
    return { draft: { action: tool, instruction, source: excerpt, sourceId: selected.id, sections: tool === "search_and_summarize" ? sections : undefined } };
  }
  if (tool === "create_tasks_from_document") {
    const selected = new Map<string, { title: string; reference: string; quote: string }>();
    for (const section of sections) for (const line of section.text.split(/\r?\n/)) {
      const [title] = taskTitles(line);
      if (title && !selected.has(title.toLowerCase())) selected.set(title.toLowerCase(),
        { title, reference: section.reference, quote: line.trim().slice(0, 200) });
    }
    const sources = [...selected.values()];
    const titles = sources.map((item) => item.title);
    if (!titles.length || titles.length > 12) throw new Clarification("The source must contain between 1 and 12 distinct TODO, action-item or unchecked checklist lines.");
    return { proposal: { ...source, tool, titles, evidence: sources.map(({ reference, quote }) => ({ reference, quote })) } };
  }
  if (tool === "duplicate_document") {
    if (args.preserve_amount !== true || args.preserve_customer !== true || (selected.mediaType !== mediaTypes.docx && body.length > 23_900)) {
      throw new Clarification("Duplication requires preserving both amount and customer on a source of at most 23,900 characters. Use explicit replacements for changes.");
    }
    const originalHash = selected.mediaType === mediaTypes.docx ? checksum(await originalBytes(workspace, selected.id)) : undefined;
    return { proposal: { ...source, tool, targetPeriod: text(args, "target_period"), preserveAmount: true, preserveCustomer: true, originalHash } };
  }
  if (tool === "modify_and_convert") {
    const replacements = args.replacements as Replacements;
    const output = args.output_format as "txt" | "pdf";
    if (selected.mediaType === mediaTypes.docx) {
      if (output !== "pdf") throw new Clarification("Use the manual template editor for DOCX output, or request a DOCX-to-PDF conversion.");
      const { plan, preview } = await buildTemplatePlan(workspace, pool, selected.id, {
        replacements: replacements.map((item) => ({ ...item, count: 1 })), output,
      });
      return { proposal: plan, preview };
    }
    const result = applyReplacements(body, replacements, output);
    if (!result || (output === "pdf" && /[^\x09\x0A\x0D\x20-\x7E]/.test(result))) {
      throw new Clarification("Specify distinct literal matches that are present in the source. PDF output supports ASCII text; use TXT for other characters.");
    }
    const offset = Math.max(0, body.indexOf(replacements[0].find) - 200);
    return { proposal: { ...source, tool, replacements, output },
      preview: { before: body.slice(offset, offset + 1600), after: result.slice(offset, offset + 1600), excerpt: true } };
  }
  throw new WorkspaceError("This action is outside the executable profile.");
}

async function pdf(text: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ margin: 46 });
    const chunks: Buffer[] = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.once("error", reject);
    document.once("end", () => resolve(Buffer.concat(chunks)));
    document.fontSize(10).text(text);
    document.end();
  });
}

export async function executeProposal(workspace: Workspace, client: pg.PoolClient, id: string, proposal: Proposal) {
  metadataFor(workspace, proposal.sourceId);
  if (proposal.tool === "create_tasks_from_document") {
    const { rows } = await client.query<{ id: string; title: string }>(`
      INSERT INTO slm_workspace.tasks (id,title,origin_approval,evidence)
      SELECT gen_random_uuid(), title,$2::uuid,$3::jsonb->((n-1)::int)
      FROM unnest($1::text[]) WITH ORDINALITY AS p(title,n) RETURNING id,title`,
      [proposal.titles, id, JSON.stringify(proposal.evidence ?? [])]);
    return { tasks: rows };
  }
  if (proposal.tool === "duplicate_document" && proposal.originalHash) return copyDocxVersion(workspace, client, id,
    proposal.sourceId, proposal.sourceTitle, proposal.targetPeriod, proposal.originalHash);
  const original = sourceText(await documentSections(client, proposal.sourceId));
  const output = proposal.tool === "duplicate_document" ? "txt" : proposal.output;
  const body: string | null = proposal.tool === "duplicate_document" ? "Draft period: " + proposal.targetPeriod + "\n\n" + original :
    applyReplacements(original, proposal.replacements, output);
  if (!body) throw new WorkspaceError("The approved transformation cannot be applied.");
  const sections = (body.match(/[\s\S]{1,2000}/gu) ?? []).map((text, i) => ({ reference: "Part " + (i + 1), text }));
  const bytes = output === "pdf" ? await pdf(body) : Buffer.from(body);
  const title = (proposal.tool === "duplicate_document" ? "Draft " + proposal.targetPeriod + " · " : "Converted · ") + proposal.sourceTitle;
  const document = prepareDocument(workspace, id, {
    title: title.slice(0, 140), filename: "draft-" + id + "." + output, tags: ["assistant-draft"], documentDate: null,
  }, mediaTypes[output], bytes, sections);
  await insertDocument(client, workspace.namespace, document, bytes, sections);
  return { document: plainMetadata(document) };
}
