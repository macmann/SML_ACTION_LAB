import { authenticated, failure, json, privateHeaders } from "@/lib/document-api";
import { boundedJson } from "@/lib/agent-input";
import { arenaCommand, arenaUpdate, arenaView } from "@/lib/arena";
import { csvCell } from "@/lib/business-export";
import { WorkspaceError } from "@/lib/database";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await authenticated();
    const format = new URL(request.url).searchParams.get("export");
    const result = await arenaView();
    if (format === "json") return json({ runs: result.runs, scores: result.scores, vendor: result.vendor });
    if (format === "csv") {
      const fields = ["model", "provider", "identity", "variant", "mode", "caseId", "predictedTool", "arguments", "validation",
        "schemaValid", "toolCorrect", "exact", "controlCorrect", "fixture", "latencyMs", "usage", "faithfulness", "error"];
      const lines = [fields.map(csvCell).join(",")];
      for (const row of result.runs) {
        const values = { ...row.result, model: row.model, faithfulness: row.faithfulness };
        lines.push(fields.map((name) => {
          const value = values[name];
          return csvCell(value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));
        }).join(","));
      }
      return new Response(lines.join("\r\n") + "\r\n", { headers: { ...privateHeaders, "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="arena-runs.csv"' } });
    }
    if (format) throw new WorkspaceError("Choose JSON or CSV.");
    return json(result);
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    await authenticated(true);
    const parsed = arenaCommand.safeParse(await boundedJson(request));
    if (!parsed.success) throw new WorkspaceError("Check selected cases, providers and explicit request confirmation.");
    return json(await arenaUpdate(parsed.data));
  } catch (error) { return failure(error); }
}
