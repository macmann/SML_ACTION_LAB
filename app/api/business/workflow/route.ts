import { randomUUID } from "node:crypto";
import { authenticated, failure, json } from "@/lib/document-api";
import { boundedJson } from "@/lib/agent-input";
import { businessDb, transaction } from "@/lib/business";
import { WorkspaceError } from "@/lib/database";
import { workflowInput, planWorkflow } from "@/lib/invoice-workflow";
import { propose } from "@/lib/approvals";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    await authenticated(true);
    const parsed = workflowInput.safeParse(await boundedJson(request));
    if (!parsed.success) throw new WorkspaceError("Check the workflow step and explicit values.");
    return json(await businessDb(async (pool, generation) => transaction(pool, async (client) => {
      const plan = await planWorkflow(client, parsed.data, randomUUID());
      return propose(pool, generation, randomUUID(), "manual", plan, client);
    })));
  } catch (error) { return failure(error); }
}
