import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { store } from "./bootstrap.mjs";
import { executeProposal, type Proposal } from "./agent-actions";
import { useDocuments, invalidateDocuments, removeDocumentFiles, type Workspace } from "./documents";
import { WorkspaceError, withDatabase, workspaceId } from "./database";
import { configuredProfile } from "./inference";
import { settingsFrom } from "./settings";
import { hash, schemaHash, schemaVersion } from "./tool-registry.mjs";

const source = { sourceId: z.uuid(), sourceTitle: z.string().min(1).max(180) };
const proposalValue = z.discriminatedUnion("tool", [
  z.strictObject({ ...source, tool: z.literal("duplicate_document"), targetPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    preserveAmount: z.literal(true), preserveCustomer: z.literal(true) }),
  z.strictObject({ ...source, tool: z.literal("create_tasks_from_document"), titles: z.array(z.string().min(1).max(140)).min(1).max(12) }),
  z.strictObject({ ...source, tool: z.literal("modify_and_convert"), output: z.enum(["txt", "pdf"]),
    replacements: z.array(z.strictObject({ find: z.string().min(1).max(120), replace: z.string().max(200) })).min(1).max(12) }),
]);
const requestSchema = z.strictObject({ profileId: z.string().regex(/^[0-9a-f]{64}$/), schemaHash: z.literal(schemaHash), plan: proposalValue });
type Stored = z.infer<typeof requestSchema>;
type Row = { id: string; status: string; request: unknown; schema_version: string; proposal_hash: string;
  idempotency_key: string; database_generation: number; expires_at: Date; updated_at: Date; outcome: unknown };
const columns = "id,status,request,schema_version,proposal_hash,idempotency_key,database_generation,expires_at,updated_at,outcome";
const digest = (request: Stored, turn: string, generation: number) => hash({ request, turn, generation, version: schemaVersion });

export async function propose(pool: pg.Pool, generation: number, turn: string, profileId: string, plan: Proposal) {
  const request = requestSchema.parse({ profileId, schemaHash, plan });
  const id = randomUUID();
  const proposalHash = digest(request, turn, generation);
  const { rows: [row] } = await pool.query<Row>(`INSERT INTO slm_workspace.approvals
    (id,status,request,idempotency_key,schema_version,proposal_hash,database_generation,expires_at)
    VALUES ($1,'pending',$2,$3,$4,$5,$6,now() + interval '15 minutes')
    ON CONFLICT (idempotency_key) DO NOTHING RETURNING ${columns}`,
    [id, request, turn, schemaVersion, proposalHash, generation]);
  if (!row) throw new WorkspaceError("This turn already has a proposal.", 409);
  return present(row);
}

function present(row: Row) {
  const parsed = requestSchema.safeParse(row.request);
  const expired = (row.status === "pending" || row.status === "approved") && row.expires_at.getTime() <= Date.now();
  return { id: row.id, hash: row.proposal_hash, version: row.schema_version, status: expired ? "expired" : row.status,
    createdFrom: row.idempotency_key, expiresAt: row.expires_at.toISOString(), plan: parsed.success ? parsed.data.plan : undefined,
    outcome: row.outcome };
}

export async function approvalList() {
  return withDatabase(async (pool, generation) => {
    await workspaceId(pool);
    const { rows } = await pool.query<Row>(
      `SELECT ${columns} FROM slm_workspace.approvals WHERE database_generation=$1 ORDER BY created_at DESC LIMIT 25`, [generation]);
    return rows.map(present);
  });
}

async function read(pool: pg.Pool, id: string) {
  const { rows: [row] } = await pool.query<Row>(`SELECT ${columns} FROM slm_workspace.approvals WHERE id=$1`, [id]);
  return row;
}

async function claim(pool: pg.Pool, row: Row, tool: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const approved = await client.query(`UPDATE slm_workspace.approvals SET status='approved', updated_at=now()
      WHERE id=$1 AND status='pending' AND expires_at>now() RETURNING id`, [row.id]);
    if (approved.rowCount !== 1) {
      await client.query("ROLLBACK");
      return false;
    }
    const executing = await client.query(`UPDATE slm_workspace.approvals SET status='executing', updated_at=now()
      WHERE id=$1 AND status='approved' AND expires_at>now() RETURNING id`, [row.id]);
    if (executing.rowCount !== 1) throw new Error();
    await client.query("INSERT INTO slm_workspace.tool_executions (id, approval_id, tool, status) VALUES ($1,$2,$3,'executing')",
      [randomUUID(), row.id, tool]);
    await client.query(`UPDATE slm_workspace.inference_logs SET execution_status='executing', updated_at=now() WHERE id=$1`, [row.idempotency_key]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function finish(client: pg.PoolClient, row: Row, status: "succeeded" | "failed", outcome: object, duration: number) {
  const result = await client.query(`UPDATE slm_workspace.approvals SET status=$2, outcome=$3, updated_at=now()
    WHERE id=$1 AND status='executing' RETURNING id`, [row.id, status, outcome]);
  if (result.rowCount !== 1) throw new Error();
  await client.query("UPDATE slm_workspace.tool_executions SET status=$2 WHERE approval_id=$1", [row.id, status]);
  await client.query(`UPDATE slm_workspace.inference_logs SET execution_status=$2, execution_ms=$3, updated_at=now()
    WHERE id=$1`, [row.idempotency_key, status, duration]);
}

async function fail(pool: pg.Pool, row: Row, message: string, duration: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await finish(client, row, "failed", { message }, duration);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function execute(pool: pg.Pool, workspace: Workspace, row: Row, plan: Proposal) {
  const start = Date.now();
  const client = await pool.connect();
  let commitStarted = false;
  let failed = false;
  try {
    await client.query("BEGIN");
    const outcome = await executeProposal(workspace, client, row.id, plan);
    await finish(client, row, "succeeded", outcome, Date.now() - start);
    commitStarted = true;
    await client.query("COMMIT");
  } catch {
    failed = true;
    await client.query("ROLLBACK").catch(() => {});
  } finally {
    client.release();
    invalidateDocuments();
  }
  if (!failed) return;
  if (!commitStarted && plan.tool !== "create_tasks_from_document") await removeDocumentFiles(workspace.namespace, row.id);
  if (!commitStarted || (await read(pool, row.id))?.status === "executing") {
    await fail(pool, row, "The approved action failed. It was not retried.", Date.now() - start);
  }
}

export function approve(id: string, expectedHash: string) {
  return useDocuments(async (workspace, pool) => {
    const row = await read(pool, id);
    if (!row || row.database_generation !== workspace.generation) throw new WorkspaceError("Approval not found.", 404);
    if (row.proposal_hash !== expectedHash) throw new WorkspaceError("The proposal hash did not match.", 409);
    if ((row.status === "pending" || row.status === "approved") && row.expires_at.getTime() <= Date.now()) {
      await pool.query(`UPDATE slm_workspace.approvals SET status='expired',updated_at=now()
        WHERE id=$1 AND status IN ('pending','approved') AND expires_at<=now()`, [id]);
      return present((await read(pool, id))!);
    }
    if (row.status !== "pending") {
      if (row.status === "executing" && row.updated_at.getTime() < Date.now() - 120_000) {
        await fail(pool, row, "Execution was interrupted and was not retried.", 120_000);
        return present((await read(pool, id))!);
      }
      return present(row);
    }
    const parsed = requestSchema.safeParse(row.request);
    if (!parsed.success || row.schema_version !== schemaVersion ||
        digest(parsed.data, row.idempotency_key, workspace.generation) !== row.proposal_hash) {
      throw new WorkspaceError("The approval contract changed. Submit a new request.", 409);
    }
    const enabledProfile = configuredProfile(settingsFrom(await store.load()), "distil");
    if (parsed.data.profileId !== enabledProfile.id) throw new WorkspaceError("The routing profile changed. Submit a new request.", 409);
    if (await claim(pool, row, parsed.data.plan.tool)) await execute(pool, workspace, row, parsed.data.plan);
    return present((await read(pool, id))!);
  });
}
