import { z } from "zod";
import { agentContext, runTurn } from "@/lib/agent";
import { boundedJson } from "@/lib/agent-input";
import { WorkspaceError } from "@/lib/database";
import { authenticated, failure, json } from "@/lib/document-api";

export const dynamic = "force-dynamic";

const input = z.strictObject({
  id: z.uuid(), request: z.string().trim().min(1).max(2000), mode: z.enum(["strict", "comparison", "model_only"]),
  active: z.array(z.uuid()).max(5).refine((ids) => new Set(ids).size === ids.length).default([]),
  experimental: z.boolean().optional(), writer: z.boolean().default(false), share: z.boolean().default(false),
});

export async function GET() {
  try { await authenticated(); return json(await agentContext()); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    await authenticated(true);
    const parsed = input.safeParse(await boundedJson(request));
    if (!parsed.success) throw new WorkspaceError("The assistant request or selected references are invalid.");
    return json(await runTurn(parsed.data));
  } catch (error) { return failure(error); }
}
