import { authenticated, failure, json } from "@/lib/document-api";
import { boundedJson } from "@/lib/agent-input";
import { WorkspaceError } from "@/lib/database";
import { spreadsheet, sheetRequest } from "@/lib/spreadsheet";
import { uuid } from "@/lib/document-files";

export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await authenticated(true);
    const { id } = await context.params;
    const parsed = sheetRequest.safeParse(await boundedJson(request));
    if (!uuid.test(id) || !parsed.success) throw new WorkspaceError("Check the sheet and analysis selections.");
    return json(await spreadsheet(id, parsed.data));
  } catch (error) { return failure(error); }
}
