import { randomUUID } from "node:crypto";
import { z } from "zod";
import type pg from "pg";
import { withDatabase, WorkspaceError, workspaceId } from "./database";
import { taskInput, noteInput, invoiceInput, expenseInput, type InvoiceInput } from "./business-validation";

const taskSelect = 'id,title,status,due_on::text AS due,evidence,source_invoice AS "sourceInvoice"';
const noteSelect = 'id,title,body';
const invoiceSelect = `id,invoice_number AS number,currency,customer,status,verified,revision,
  issued_on::text AS issued,due_on::text AS due,amount::text,tax::text,
  CASE WHEN amount IS NULL THEN NULL ELSE (amount+COALESCE(tax,0))::text END AS total,
  source_document AS source`;
export type Invoice = InvoiceInput & { id: string; verified: boolean; status: string; revision: number; total: string | null };

export function businessDb<T>(operation: (pool: pg.Pool, generation: number) => Promise<T>) {
  return withDatabase(async (pool, generation) => {
    await workspaceId(pool);
    return operation(pool, generation);
  });
}

export async function transaction<T>(pool: pg.Pool, operation: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await operation(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function getInvoice(db: pg.Pool | pg.PoolClient, id: string) {
  const { rows: [invoice] } = await db.query<Invoice>("SELECT " + invoiceSelect + " FROM slm_workspace.invoices WHERE id=$1", [id]);
  if (!invoice) throw new WorkspaceError("Invoice not found.", 404);
  return invoice;
}

export async function insertInvoice(client: pg.PoolClient, id: string, input: InvoiceInput, verified: boolean) {
  await client.query("SELECT pg_advisory_xact_lock(1936485681, 841306)");
  if (input.source && !(await client.query("SELECT 1 FROM slm_workspace.documents WHERE id=$1", [input.source])).rowCount) {
    throw new WorkspaceError("The source document was not found.", 404);
  }
  if ((await client.query(`SELECT 1 FROM slm_workspace.invoices WHERE lower(invoice_number)=lower($1)
    UNION ALL SELECT 1 FROM slm_workspace.template_invoice_numbers WHERE number=lower($1)`, [input.number])).rowCount) {
    throw new WorkspaceError("The invoice number is already registered.", 409);
  }
  await client.query(`INSERT INTO slm_workspace.invoices
    (id,invoice_number,currency,status,issued_on,customer,due_on,amount,tax,source_document,verified)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, input.number, input.currency, verified ? "draft" : "imported", input.issued, input.customer,
      input.due, input.amount, input.tax, input.source, verified]);
  return getInvoice(client, id);
}

export function businessListing() {
  return businessDb(async (pool) => {
    const result = await Promise.all([
      pool.query("SELECT " + taskSelect + " FROM slm_workspace.tasks ORDER BY created_at DESC,id LIMIT 200"),
      pool.query("SELECT " + noteSelect + " FROM slm_workspace.notes ORDER BY created_at DESC,id LIMIT 200"),
      pool.query("SELECT " + invoiceSelect + " FROM slm_workspace.invoices ORDER BY issued_on DESC NULLS LAST,id LIMIT 200"),
      pool.query("SELECT id,description,incurred_on::text AS incurred,amount::text,currency FROM slm_workspace.expenses ORDER BY incurred_on DESC,id LIMIT 200"),
      pool.query(`SELECT currency,sum(amount+COALESCE(tax,0))::text AS amount FROM slm_workspace.invoices
        WHERE verified AND status='unpaid' AND amount IS NOT NULL GROUP BY currency ORDER BY currency`),
      pool.query(`SELECT id,source_invoice AS "sourceInvoice",draft_invoice AS "draftInvoice",email_draft AS "emailDraft",stage
        FROM slm_workspace.invoice_workflows ORDER BY created_at DESC,id LIMIT 50`),
    ]);
    const [tasks, notes, invoices, expenses, outstanding, workflows] = result.map((result) => result.rows);
    return { tasks, notes, invoices, expenses, outstanding, workflows };
  });
}

export const businessCommand = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("task_save"), id: z.uuid().optional(), input: taskInput }),
  z.strictObject({ operation: z.literal("note_save"), id: z.uuid().optional(), input: noteInput }),
  z.strictObject({ operation: z.literal("task_delete"), id: z.uuid(), confirmed: z.literal(true) }),
  z.strictObject({ operation: z.literal("note_delete"), id: z.uuid(), confirmed: z.literal(true) }),
  z.strictObject({ operation: z.literal("invoice_create"), input: invoiceInput, confirmed: z.literal(true) }),
  z.strictObject({ operation: z.literal("invoice_verify"), id: z.uuid(), revision: z.number().int().positive(), input: invoiceInput, confirmed: z.literal(true) }),
  z.strictObject({ operation: z.literal("invoice_status"), id: z.uuid(), revision: z.number().int().positive(),
    status: z.enum(["unpaid", "paid"]), confirmed: z.literal(true) }),
  z.strictObject({ operation: z.literal("follow_up"), id: z.uuid(), input: taskInput, confirmed: z.literal(true) }),
  z.strictObject({ operation: z.literal("expense_create"), input: expenseInput }),
]);

export function updateBusiness(command: z.infer<typeof businessCommand>) {
  return businessDb(async (pool) => {
    const id = "id" in command && command.id ? command.id : randomUUID();
    switch (command.operation) {
      case "task_save": {
        const { input } = command;
        const result = command.id ? await pool.query("UPDATE slm_workspace.tasks SET title=$2,status=$3,due_on=$4 WHERE id=$1",
          [id, input.title, input.status, input.due]) : await pool.query("INSERT INTO slm_workspace.tasks(id,title,status,due_on) VALUES($1,$2,$3,$4)",
          [id, input.title, input.status, input.due]);
        if (!result.rowCount) throw new WorkspaceError("Task not found.", 404);
        break;
      }
      case "note_save": {
        const { input } = command;
        const result = command.id ? await pool.query("UPDATE slm_workspace.notes SET title=$2,body=$3 WHERE id=$1", [id, input.title, input.body]) :
          await pool.query("INSERT INTO slm_workspace.notes(id,title,body) VALUES($1,$2,$3)", [id, input.title, input.body]);
        if (!result.rowCount) throw new WorkspaceError("Note not found.", 404);
        break;
      }
      case "task_delete": {
        if (!(await pool.query("DELETE FROM slm_workspace.tasks WHERE id=$1", [id])).rowCount) throw new WorkspaceError("Task not found.", 404);
        break;
      }
      case "note_delete": {
        if (!(await pool.query("DELETE FROM slm_workspace.notes WHERE id=$1", [id])).rowCount) throw new WorkspaceError("Note not found.", 404);
        break;
      }
      case "invoice_create":
        return transaction(pool, (client) => insertInvoice(client, id, command.input, !command.input.source));
      case "invoice_verify": {
        const { input } = command;
        const original = await getInvoice(pool, id);
        if (original.number !== input.number || original.source !== input.source || original.status !== "imported") {
          throw new WorkspaceError("Verify the original import and keep its source and number.", 409);
        }
        if (!(await pool.query(`UPDATE slm_workspace.invoices SET verified=true,status='draft',currency=$3,customer=$4,amount=$5,tax=$6,
          issued_on=$7,due_on=$8,revision=revision+1 WHERE id=$1 AND revision=$2 AND status='imported'`,
          [id, command.revision, input.currency, input.customer, input.amount, input.tax, input.issued, input.due])).rowCount) {
          throw new WorkspaceError("The invoice changed. Reload before confirming.", 409);
        }
        break;
      }
      case "invoice_status": {
        const allowed = command.status === "unpaid" ? ["draft"] : ["unpaid"];
        if (!(await pool.query(`UPDATE slm_workspace.invoices SET status=$3,revision=revision+1
          WHERE id=$1 AND revision=$2 AND verified AND amount IS NOT NULL AND status=ANY($4::text[])`,
          [id, command.revision, command.status, allowed])).rowCount) {
          throw new WorkspaceError("This invoice is unverified, changed, or cannot make that status transition.", 409);
        }
        break;
      }
      case "follow_up": {
        const invoice = await getInvoice(pool, id);
        if (!invoice.verified) throw new WorkspaceError("Verify the invoice before creating a follow-up.");
        const taskId = randomUUID();
        await pool.query("INSERT INTO slm_workspace.tasks(id,title,status,due_on,source_invoice) VALUES($1,$2,$3,$4,$5)",
          [taskId, command.input.title, command.input.status, command.input.due, id]);
        return { id: taskId };
      }
      case "expense_create": {
        const { input } = command;
        await pool.query("INSERT INTO slm_workspace.expenses(id,description,incurred_on,amount,currency) VALUES($1,$2,$3,$4,$5)",
          [id, input.description, input.incurred, input.amount, input.currency]);
        break;
      }
    }
    return { id };
  });
}
