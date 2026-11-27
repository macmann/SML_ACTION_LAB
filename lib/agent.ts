import type pg from "pg";
import { store } from "./bootstrap.mjs";
import { Clarification, grounded, performAction, type Args } from "./agent-actions";
import { useDocuments } from "./documents";
import { approvalList, propose } from "./approvals";
import { withDatabase, workspaceId, WorkspaceError } from "./database";
import { configuredProfile, routeTurn, summarize, summaryProfile, writeContent, type Mode } from "./inference";
import { settingsFrom } from "./settings";
import { controlNames, hash, mutationNames, normalizeCall } from "./tool-registry.mjs";

export type Turn = { id: string; request: string; mode: Mode; active: string[]; writer: boolean; experimental?: boolean; share: boolean };
type Audit = {
  identity?: string; predicted?: string; validation?: string; execution?: string;
  routingMs?: number; executionMs?: number; writerMs?: number; writerStatus?: string;
  writerIdentity?: string; writingProfile?: object;
};
function ensureGeneration(current: number, expected: number) {
  if (current !== expected) throw new WorkspaceError("The active database changed. Start a new turn.", 409);
}

export function saveAudit(pool: pg.Pool, id: string, audit: Audit) {
  return pool.query(`UPDATE slm_workspace.inference_logs SET
    provider_identity=COALESCE($2,provider_identity), predicted_tool=COALESCE($3,predicted_tool),
    validation_status=COALESCE($4,validation_status), execution_status=COALESCE($5,execution_status),
    routing_ms=COALESCE($6,routing_ms), execution_ms=COALESCE($7,execution_ms), writer_ms=COALESCE($8,writer_ms),
    writer_status=COALESCE($9,writer_status), writer_identity=COALESCE($10,writer_identity),
    writing_profile=COALESCE($11,writing_profile), updated_at=now() WHERE id=$1`, [
    id, audit.identity, audit.predicted, audit.validation, audit.execution, audit.routingMs, audit.executionMs,
    audit.writerMs, audit.writerStatus, audit.writerIdentity, audit.writingProfile,
  ]);
}

export async function runTurn(turn: Turn) {
  const settings = settingsFrom(await store.load());
  const generation = settings.databaseGeneration ?? 1;
  const profile = configuredProfile(settings, turn.mode === "comparison" ? "comparison" : "distil");
  const update = (audit: Audit) => withDatabase(async (pool, current) => {
    ensureGeneration(current, generation);
    await saveAudit(pool, turn.id, audit);
  });
  const started = await withDatabase(async (pool, current) => {
    ensureGeneration(current, generation);
    await workspaceId(pool);
    if (turn.active.length) {
      const { rowCount } = await pool.query("SELECT document_id FROM slm_workspace.active_attachments WHERE document_id=ANY($1::uuid[])", [turn.active]);
      if (rowCount !== turn.active.length) throw new WorkspaceError("Choose references from active attachments.", 400);
    }
    const inserted = await pool.query(`INSERT INTO slm_workspace.inference_logs
      (id,provider,model,status,mode,routing_profile,validation_status,execution_status,provider_identity)
      VALUES($1,$2,$3,'recorded',$4,$5,'awaiting_provider','not_started','unverified')
      ON CONFLICT (id) DO NOTHING RETURNING id`, [turn.id, profile.role, profile.model, turn.mode, profile]);
    return inserted.rowCount === 1;
  });
  if (!started) return { status: "replayed", message: "This turn ID was already used. Check approvals or logs." };

  const startedAt = Date.now();
  let routed;
  try { routed = await routeTurn(settings, profile, turn.request, turn.active.length); }
  catch (error) {
    await update({ validation: error instanceof WorkspaceError && error.status === 504 ? "provider_timeout" : "provider_error", execution: "not_executed", routingMs: Date.now() - startedAt });
    throw error;
  }
  const call = normalizeCall(routed.response);
  const identity = routed.identity;
  await update({ identity, predicted: call.name, validation: call.status, routingMs: Date.now() - startedAt });
  const common = { identity, model: profile.model, mode: turn.mode, tool: call.name };
  if (call.status !== "valid" || !call.name) {
    await update({ execution: "not_executed" });
    return { ...common, status: "rejected", validation: call.status, message: "The provider did not produce one valid native tool call." };
  }
  const tool = call.name;
  const args: Args = call.args;
  if (!grounded(tool, args, turn.request)) {
    await update({ validation: "ungrounded", execution: "not_executed" });
    return { ...common, status: "clarification", message: "Give explicit ISO dates or identifiers. Quote literal replacements in the request." };
  }
  if (controlNames.has(tool)) {
    await update({ execution: "control" });
    return { ...common, status: tool === "clarification_required" ? "clarification" : "unsupported",
      message: tool === "clarification_required" ? args.question : args.reason };
  }
  if (turn.mode !== "strict") {
    await update({ execution: "model_only" });
    return { ...common, status: "prediction", result: args, message: "Validated prediction. No tool executed." };
  }
  if (mutationNames.has(tool) && identity !== "attested") {
    await update({ execution: "identity_blocked" });
    return { ...common, status: "rejected", message: "Strict mode requires a verified model attestation for mutations." };
  }
  const processingStarted = Date.now();
  try {
    const action = await useDocuments(async (workspace, pool) => {
      ensureGeneration(workspace.generation, generation);
      const active = turn.active.filter((id) => workspace.index.documents.get(id)?.attached);
      if (active.length !== turn.active.length) throw new Clarification("An active attachment changed. Select the documents again.");
      const result = await performAction(workspace, pool, tool, args, active);
      if ("proposal" in result) {
        const current = configuredProfile(settingsFrom(await store.load()), "distil");
        if (current.id !== profile.id) throw new WorkspaceError("The model profile changed. Start a new turn.", 409);
        const proposal = await propose(pool, generation, turn.id, profile.id, result.proposal);
        await saveAudit(pool, turn.id, { execution: "pending", executionMs: Date.now() - processingStarted });
        return { proposal, preview: result.preview };
      }
      return result;
    });
    if ("proposal" in action) return { ...common, status: "pending", approval: action.proposal, result: action.preview };
    if ("draft" in action) {
      if (!turn.writer || !turn.share || !settings.preferences?.shareDocuments || !turn.active.includes(action.draft.sourceId)) {
        throw new Clarification("Select the source as an active document, select the writer, and allow document sharing in Preferences and for this turn.");
      }
      const role = turn.experimental ? "distil" : "writer";
      const chosen = configuredProfile(settings, role);
      const writer = action.draft.sections ? summaryProfile(chosen) : chosen;
      if (turn.experimental && !action.draft.sections) throw new Clarification("Experimental SLM writing is available for evidence summaries.");
      const latest = settingsFrom(await store.load());
      ensureGeneration(latest.databaseGeneration ?? 1, generation);
      if (!latest.preferences?.shareDocuments || !latest[role] || hash(latest[role]) !== hash(settings[role])) {
        throw new Clarification("Writer settings or document-sharing preferences changed. Start a new turn.");
      }
      const start = Date.now();
      await update({ writerStatus: "running", writingProfile: writer, writerIdentity: "unverified" });
      let result;
      try {
        result = action.draft.sections ? await summarize(latest, writer, action.draft.instruction, action.draft.sections) :
          { draft: await writeContent(latest, writer, action.draft) };
      }
      catch (error) {
        await update({ writerStatus: error instanceof WorkspaceError && error.status === 504 ? "timeout" : "failed", writerMs: Date.now() - start });
        throw error;
      }
      await update({ writerStatus: "succeeded", writerMs: Date.now() - start, execution: "succeeded",
        executionMs: Date.now() - processingStarted });
      return { ...common, status: "completed", result: { ...result, sourceId: action.draft.sourceId, writer: writer.model, writerIdentity: "unverified" } };
    }
    await update({ execution: "succeeded", executionMs: Date.now() - processingStarted });
    return { ...common, status: "completed", result: action.result };
  } catch (error) {
    await update({ execution: error instanceof Clarification ? "clarification" : "failed",
      executionMs: Date.now() - processingStarted });
    if (error instanceof Clarification) return { ...common, status: "clarification", message: error.message };
    throw error;
  }
}

export async function agentContext() {
  const approvals = await approvalList();
  const attachments = await withDatabase(async (pool) => {
    const { rows } = await pool.query<{ id: string; title: string }>(`SELECT d.id,d.title FROM slm_workspace.documents d
      JOIN slm_workspace.active_attachments a ON a.document_id=d.id ORDER BY d.title,d.id LIMIT 30`);
    return rows;
  });
  return { approvals, attachments };
}

export async function agentLogs() {
  return withDatabase(async (pool) => {
    await workspaceId(pool);
    const { rows } = await pool.query(`SELECT id,provider,model,mode,provider_identity AS identity,predicted_tool AS tool,
      validation_status AS validation,execution_status AS execution,routing_ms AS "routingMs",execution_ms AS "executionMs",
      writer_ms AS "writerMs",writer_status AS "writerStatus",writer_identity AS "writerIdentity",
      writing_profile->>'model' AS "writerModel", routing_profile->>'schemaHash' AS "schemaHash",created_at AS "createdAt"
      FROM slm_workspace.inference_logs ORDER BY created_at DESC LIMIT 50`);
    return rows;
  });
}
