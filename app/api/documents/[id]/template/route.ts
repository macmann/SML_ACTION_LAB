import { randomUUID } from "node:crypto";
import { boundedJson } from "@/lib/agent-input";
import { propose } from "@/lib/approvals";
import { WorkspaceError } from "@/lib/database";
import { authenticated, failure, json } from "@/lib/document-api";
import { uuid } from "@/lib/document-files";
import { useDocuments } from "@/lib/documents";
import { buildTemplatePlan, templateInput } from "@/lib/template-workspace";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await authenticated(true);
    const { id } = await context.params;
    if (!uuid.test(id)) throw new WorkspaceError("Document not found.", 404);
    const parsed = z.strictObject({ input: templateInput, propose: z.boolean(), previewHash: z.string().regex(/^[a-f0-9]{64}$/).optional() })
      .safeParse(await boundedJson(request));
    if (!parsed.success) throw new WorkspaceError("Check replacement counts and explicit invoice dates, number, currency and payment terms.");
    const data = parsed.data;
    return json(await useDocuments(async (workspace, pool) => {
      const { plan, preview } = await buildTemplatePlan(workspace, pool, id.toLowerCase(), data.input);
      const { hash } = await import("@/lib/tool-registry.mjs");
      const digest = hash(plan);
      if (!data.propose) return { preview, previewHash: digest, originalHash: plan.originalHash };
      if (digest !== data.previewHash) throw new WorkspaceError("Rebuild the preview before requesting approval.", 409);
      const approval = await propose(pool, workspace.generation, randomUUID(), "manual", plan);
      return { preview, approval };
    }));
  } catch (error) { return failure(error); }
}
