import { z } from "zod";
import type pg from "pg";
import { calendar, invoiceInput, invoiceNumber, title } from "./business-validation";
import { getInvoice, insertInvoice } from "./business";
import { WorkspaceError } from "./database";
import { store } from "./bootstrap.mjs";
import { settingsFrom } from "./settings";
import { configuredProfile, writeContent } from "./inference";
import { hash } from "./tool-registry.mjs";

const copy = { source: z.uuid(), number: invoiceNumber, issued: calendar, due: calendar };
export const workflowInput = z.discriminatedUnion("step", [
  z.strictObject({ step: z.literal("copy"), ...copy }),
  z.strictObject({ step: z.literal("draft"), workflow: z.uuid(), useWriter: z.literal(true) }),
  z.strictObject({ step: z.literal("follow_up"), workflow: z.uuid(), title, due: calendar.nullable() }),
]);

const common = { tool: z.literal("invoice_workflow"), workflow: z.uuid() };
export const workflowPlan = z.discriminatedUnion("step", [
  z.strictObject({ ...common, step: z.literal("copy"), ...copy, revision: z.number().int().positive() }),
  z.strictObject({ ...common, step: z.literal("draft"), writerId: z.string().regex(/^[a-f0-9]{64}$/),
    writerBinding: z.string().regex(/^[a-f0-9]{64}$/), writerModel: z.string().max(160),
    invoice: z.uuid(), revision: z.number().int().positive() }),
  z.strictObject({ ...common, step: z.literal("follow_up"), title, due: calendar.nullable() }),
]);
export type WorkflowPlan = z.infer<typeof workflowPlan>;

async function workflow(db: pg.Pool | pg.PoolClient, id: string, lock = false) {
  const { rows: [record] } = await db.query<{ id: string; source_invoice: string; draft_invoice: string | null; stage: string }>(
    "SELECT id,source_invoice,draft_invoice,stage FROM slm_workspace.invoice_workflows WHERE id=$1" + (lock ? " FOR UPDATE" : ""), [id]);
  if (!record) throw new WorkspaceError("Workflow not found.", 404);
  return record;
}

export async function planWorkflow(db: pg.PoolClient, input: z.infer<typeof workflowInput>, id: string): Promise<WorkflowPlan> {
  if (input.step === "copy") {
    const source = await getInvoice(db, input.source);
    if (!source.verified || !invoiceInput.safeParse({ ...pickInvoice(source), number: input.number, issued: input.issued, due: input.due }).success) {
      throw new WorkspaceError("Choose a verified invoice, a new number and explicit valid dates.", 422);
    }
    await db.query("INSERT INTO slm_workspace.invoice_workflows(id,source_invoice,stage) VALUES ($1,$2,'awaiting_copy')", [id, input.source]);
    return { tool: "invoice_workflow", workflow: id, ...input, revision: source.revision };
  }
  const record = await workflow(db, input.workflow);
  if (input.step === "draft") {
    if (record.stage !== "copied" || !record.draft_invoice) throw new WorkspaceError("Approve the invoice copy first.", 409);
    const invoice = await getInvoice(db, record.draft_invoice);
    if (!invoice.verified) throw new WorkspaceError("The invoice must be verified.");
    const settings = settingsFrom(await store.load());
    const profile = configuredProfile(settings, "writer");
    return { tool: "invoice_workflow", step: "draft", workflow: input.workflow, writerId: profile.id, writerBinding: hash(settings.writer),
      writerModel: profile.model, invoice: invoice.id, revision: invoice.revision };
  }
  if (record.stage !== "drafted") throw new WorkspaceError("Approve the email draft first.", 409);
  return { tool: "invoice_workflow", ...input };
}

function pickInvoice(invoice: Awaited<ReturnType<typeof getInvoice>>) {
  const { number, currency, customer, amount, tax, issued, due, source } = invoice;
  return { number, currency, customer, amount, tax, issued, due, source };
}

export async function executeWorkflow(client: pg.PoolClient, id: string, plan: WorkflowPlan) {
  const record = await workflow(client, plan.workflow, true);
  if (plan.step === "copy") {
    if (record.stage !== "awaiting_copy" || record.source_invoice !== plan.source) throw new WorkspaceError("The workflow has already advanced.", 409);
    const original = await getInvoice(client, plan.source);
    if (original.revision !== plan.revision || !original.verified) throw new WorkspaceError("The source invoice changed. Start a new workflow.", 409);
    const invoice = invoiceInput.parse({ ...pickInvoice(original), number: plan.number, issued: plan.issued, due: plan.due });
    const draft = await insertInvoice(client, id, invoice, true);
    await client.query("UPDATE slm_workspace.invoice_workflows SET draft_invoice=$2,stage='copied' WHERE id=$1", [plan.workflow, draft.id]);
    return { invoiceId: id, workflow: plan.workflow, stage: "copied" };
  }
  if (plan.step === "draft") {
    if (record.stage !== "copied" || record.draft_invoice !== plan.invoice) throw new WorkspaceError("The workflow has already advanced.", 409);
    const invoice = await getInvoice(client, plan.invoice);
    if (invoice.revision !== plan.revision || !invoice.verified) throw new WorkspaceError("The draft invoice changed. Preview the email again.", 409);
    const settings = settingsFrom(await store.load());
    const profile = configuredProfile(settings, "writer");
    if (profile.id !== plan.writerId || hash(settings.writer) !== plan.writerBinding) throw new WorkspaceError("The selected writer changed.", 409);
    const verified = invoiceInput.parse(pickInvoice(invoice));
    const draft = await writeContent(settings, profile, {
      action: "draft_email", instruction: "Draft a brief invoice email from these verified fields. Leave recipients unspecified.",
      source: JSON.stringify({ ...verified, source: undefined, total: invoice.total }),
    });
    await client.query("UPDATE slm_workspace.invoice_workflows SET email_draft=$2,stage='drafted' WHERE id=$1", [plan.workflow, draft]);
    return { draft, workflow: plan.workflow, stage: "drafted" };
  }
  if (record.stage !== "drafted" || !record.draft_invoice) throw new WorkspaceError("The workflow has already advanced.", 409);
  await client.query(`INSERT INTO slm_workspace.tasks(id,title,due_on,source_invoice,origin_approval)
    VALUES($1,$2,$3,$4,$1)`, [id, plan.title, plan.due, record.draft_invoice]);
  await client.query("UPDATE slm_workspace.invoice_workflows SET stage='completed' WHERE id=$1", [plan.workflow]);
  return { taskId: id, workflow: plan.workflow, stage: "completed" };
}
