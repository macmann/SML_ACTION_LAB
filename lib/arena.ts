import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { store } from "./bootstrap.mjs";
import { settingsFrom, type Role } from "./settings";
import { configuredProfile, routeTurn, benchmarkContent } from "./inference";
import { writerPrompt, type ModelProfile } from "./model-profile";
import { WorkspaceError } from "./database";
import { businessDb, transaction } from "./business";
import { schemaHash, hash } from "./tool-registry.mjs";
import { scoreRoute, reportedUsage, aggregateArena } from "./arena-scoring.mjs";
import { DocumentIndex, type Metadata } from "./document-search";
import { mediaTypes } from "./extraction";

type RouterCase = { id: string; messages: [{ content: string }, { content: string }, {
  tool_calls: [{ function: { name: string; arguments: Record<string, unknown> } }];
}] };
const generation = [
  { id: "generation-summary-a", action: "summary", instruction: "Summarize the confirmed meeting decisions in two bullets.",
    source: "The fictional Loon Workshop meets on 2030-05-08. Volunteers approved three repair kits. Funding is undecided." },
  { id: "generation-summary-b", action: "summary", instruction: "Give a short summary, noting open questions.",
    source: "The imaginary Fern Library accepted four display boards. The opening date was not set. No cost was approved." },
  { id: "generation-email-a", action: "email", instruction: "Draft a short email acknowledging the order. Do not invent a recipient.",
    source: "The fictional Tern Choir confirmed eight copies of the program. Pickup is on 2031-02-06. No price is documented." },
  { id: "generation-email-b", action: "email", instruction: "Draft a polite clarification about the missing deadline.",
    source: "The imaginary Moss Theater ordered two cue binders and quoted EUR 12. No deadline was supplied." },
];
let cases: Promise<RouterCase[]> | undefined;
function holdout() {
  return cases ??= (async () => {
    const path = join(process.cwd(), "training");
    const manifest = JSON.parse(await readFile(/* turbopackIgnore: true */ join(path, "manifest.json"), "utf8"));
    const bytes = await readFile(/* turbopackIgnore: true */ join(path, "local/holdout.jsonl"));
    const lock = await readFile(/* turbopackIgnore: true */ join(path, "local/holdout.sha256"), "utf8");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (manifest.schemaHash !== schemaHash || manifest.sha256["local/holdout.jsonl"] !== digest || lock.trim() !== digest) {
      throw new WorkspaceError("The locked holdout does not match its manifest.", 503);
    }
    const rows = bytes.toString("utf8").trim().split("\n").map((line) => JSON.parse(line));
    if (rows.length !== 100) throw new WorkspaceError("The locked holdout row count is invalid.", 503);
    return rows;
  })().catch((error) => { cases = undefined; throw error; });
}

const runInput = z.strictObject({
  batchId: z.uuid(), mode: z.enum(["routing", "generation"]),
  cases: z.array(z.string().max(100)).min(1).max(4).refine((items) => new Set(items).size === items.length),
  roles: z.array(z.enum(["distil", "comparison", "writer"])).min(1).max(2).refine((items) => new Set(items).size === items.length),
  cap: z.number().int().min(1).max(8), confirmed: z.literal(true),
});
export const arenaCommand = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("run"), input: runInput }),
  z.strictObject({ operation: z.literal("vendor"), variant: z.enum(["base", "tuned"]), source: z.string().trim().min(1).max(140),
    samples: z.number().int().min(1).max(1000000), correct: z.number().int().min(0).max(1000000) }),
  z.strictObject({ operation: z.literal("review"), id: z.uuid(), faithfulness: z.number().int().min(0).max(3), notes: z.string().trim().max(1000) }),
]);

function caseUuid(id: string) {
  const h = createHash("sha256").update("arena-v1/" + id).digest("hex");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-8" + h.slice(17, 20) + "-" + h.slice(20, 32);
}

function searchFixture(expected: RouterCase["messages"][2]["tool_calls"][0]["function"], score: ReturnType<typeof scoreRoute>) {
  if (expected.name !== "search_documents" || !expected.arguments.file_type || expected.arguments.date_filter) return "not_run";
  if (!score.schemaValid || score.predictedTool !== "search_documents") return "fail";
  const index = new DocumentIndex();
  const doc = { id: "fixture", filename: String(expected.arguments.query), title: String(expected.arguments.query), tags: [],
    uploadedAt: "2030-06-01T00:00:00Z", documentDate: null,
    mediaType: mediaTypes[expected.arguments.file_type as keyof typeof mediaTypes], size: 30,
    extraction: "extracted", attached: false } satisfies Metadata;
  index.add([{ metadata: doc, ordinal: 0, text: "Fictional holdout fixture", reference: "Section 1" }]);
  const args = score.arguments;
  const date = args.date_filter;
  const found = index.find({ query: args.query, mediaType: args.file_type ? mediaTypes[args.file_type as keyof typeof mediaTypes] : "",
    tag: "", dateField: date?.field ?? "uploaded", from: date?.from ?? "", to: date?.to ?? "", sort: "relevance" });
  return found.total === 1 && found.results[0].id === doc.id ? "pass" : "fail";
}

async function evaluate(input: z.infer<typeof runInput>) {
  const requested = input.cases.length * input.roles.length;
  if (requested !== input.cap || input.mode === "routing" && input.roles.includes("writer")) {
    throw new WorkspaceError("Confirm a request cap that matches the selected cases and compatible providers.");
  }
  const router = input.mode === "routing" ? await holdout() : [];
  const rows = input.cases.map((id) => input.mode === "routing" ? router.find((row) => row.id === id) : generation.find((row) => row.id === id));
  if (rows.some((row) => !row)) throw new WorkspaceError("Choose locked cases for the selected evaluation mode.");
  const settings = settingsFrom(await store.load());
  const reference = input.mode === "routing" && input.roles.includes("distil") ? configuredProfile(settings, "distil") : null;
  const profiles = input.roles.map((role) => {
    const original = configuredProfile(settings, role as Role);
    if (input.mode === "routing" && role === "distil") return original;
    const shared = input.mode === "routing" ? { sampling: reference?.sampling ?? original.sampling, thinking: reference?.thinking ?? "off" as const } :
      { systemPrompt: writerPrompt, thinking: "off" as const, sampling: { temperature: 0, topP: 1, maxCompletionTokens: 512 } };
    if (shared.thinking === "on" && !settings[role]?.custom) throw new WorkspaceError("The selected comparison endpoint cannot match the thinking settings.");
    const profile = { ...original, ...shared };
    return { ...profile, id: hash({ ...profile, id: undefined }) };
  });
  await businessDb((pool, generation) => {
    if (generation !== (settings.databaseGeneration ?? 1)) throw new WorkspaceError("The active database changed.", 409);
    return transaction(pool, async (client) => {
      if (!(await client.query("INSERT INTO slm_workspace.arena_batches(id,request_cap) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [input.batchId, input.cap])).rowCount) throw new WorkspaceError("This batch was already recorded and will not be retried.", 409);
      for (const row of rows) {
        await client.query("INSERT INTO slm_workspace.benchmark_cases(id,title,input) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [caseUuid(row!.id), row!.id, row]);
      }
    });
  });
  const results = [];
  for (const row of rows) for (const profile of profiles) {
    const start = Date.now();
    const id = randomUUID();
    const base = { mode: input.mode, provider: profile.role, variant: profile.provenance?.variant, schemaHash, profile, batch: input.batchId, caseId: row!.id };
    let result: Record<string, unknown>;
    try {
      if ("messages" in row!) {
        const context = JSON.parse(row.messages[1].content);
        const expected = row.messages[2].tool_calls[0].function;
        const value = await routeTurn(settings, profile, context.request, context.active_documents.length);
        const score = scoreRoute(value.response, expected);
        result = { ...base, ...score, expected, identity: value.identity, usage: reportedUsage(value.response),
          fixture: searchFixture(expected, score) };
      } else {
        const test = row as typeof generation[number];
        const value = await benchmarkContent(settings, profile as ModelProfile, { action: test.action, instruction: test.instruction, source: test.source });
        result = { ...base, identity: value.identity, draft: value.text, source: test.source,
          usage: reportedUsage(value.response), review: "pending" };
      }
    } catch (error) {
      const expected = row && "messages" in row ? row.messages[2].tool_calls[0].function : undefined;
      result = { ...base, expected, identity: "unverified", error: error instanceof WorkspaceError ? error.message : "The evaluation failed.",
        controlCorrect: expected && ["clarification_required", "unsupported_intent"].includes(expected.name) ? false : null, fixture: "not_run" };
    }
    result.latencyMs = Date.now() - start;
    await businessDb((pool, generation) => {
      if (generation !== (settings.databaseGeneration ?? 1)) throw new WorkspaceError("The active database changed. The batch was stopped.", 409);
      return pool.query("INSERT INTO slm_workspace.benchmark_runs(id,case_id,model,result) VALUES($1,$2,$3,$4)",
        [id, caseUuid(row!.id), profile.model, result]);
    });
    results.push({ id, model: profile.model, result });
  }
  return results;
}

export async function arenaView() {
  const locked = await holdout();
  const settings = settingsFrom(await store.load());
  const results = await businessDb(async (pool) => {
    const [runs, vendor] = await Promise.all([
      pool.query(`SELECT r.id,r.model,r.result,r.created_at AS "createdAt",h.faithfulness,h.notes
        FROM slm_workspace.benchmark_runs r LEFT JOIN slm_workspace.arena_reviews h ON r.id=h.run_id
        WHERE r.result->>'mode' IN ('routing','generation') ORDER BY r.created_at DESC LIMIT 200`),
      pool.query("SELECT id,variant,source,samples,correct FROM slm_workspace.arena_vendor_metrics ORDER BY created_at DESC LIMIT 50"),
    ]);
    return { runs: runs.rows, vendor: vendor.rows };
  });
  return { ...results, scores: aggregateArena(results.runs), routing: locked.map((row) => ({
    id: row.id, request: JSON.parse(row.messages[1].content).request,
  })), generation, providers: ["distil", "comparison", "writer"].flatMap((role) =>
    settings[role as Role] && !(role === "distil" && settings.providerChoice === "skipped") ? [{ role, model: settings[role as Role]!.model }] : []) };
}

export async function arenaUpdate(command: z.infer<typeof arenaCommand>) {
  if (command.operation === "run") return evaluate(command.input);
  if (command.operation === "vendor") {
    if (command.correct > command.samples) throw new WorkspaceError("Correct cases cannot exceed the vendor sample count.");
    return businessDb(async (pool) => {
      await pool.query("INSERT INTO slm_workspace.arena_vendor_metrics(id,variant,source,samples,correct) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), command.variant, command.source, command.samples, command.correct]);
      return { recorded: true };
    });
  }
  return businessDb(async (pool) => {
    const inserted = await pool.query(`INSERT INTO slm_workspace.arena_reviews(run_id,faithfulness,notes)
      SELECT id,$2,$3 FROM slm_workspace.benchmark_runs WHERE id=$1 AND result->>'mode'='generation' AND result ? 'draft'
      ON CONFLICT (run_id) DO UPDATE SET faithfulness=EXCLUDED.faithfulness,notes=EXCLUDED.notes,reviewed_at=now() RETURNING run_id`,
      [command.id, command.faithfulness, command.notes]);
    if (!inserted.rowCount) throw new WorkspaceError("Select a completed generation run.", 404);
    return { recorded: true };
  });
}
