import { z } from "zod";
import { approve } from "@/lib/approvals";
import { boundedJson } from "@/lib/agent-input";
import { WorkspaceError } from "@/lib/database";
import { authenticated, failure, json } from "@/lib/document-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await authenticated(true);
    const id = z.uuid().safeParse((await context.params).id);
    const input = z.strictObject({ hash: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(await boundedJson(request));
    if (!id.success || !input.success) throw new WorkspaceError("The approval reference is invalid.");
    return json(await approve(id.data, input.data.hash));
  } catch (error) { return failure(error); }
}
