import { authenticated, failure, json, privateHeaders } from "@/lib/document-api";
import { uuid } from "@/lib/document-files";
import { attachDocument, deleteDocument, previewDocument } from "@/lib/documents";
import { WorkspaceError } from "@/lib/database";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function idFor(context: Context) {
  const { id } = await context.params;
  if (!uuid.test(id)) throw new WorkspaceError("Document not found.", 404);
  return id.toLowerCase();
}

export async function GET(_request: Request, context: Context) {
  try {
    await authenticated();
    return json(await previewDocument(await idFor(context)));
  } catch (error) { return failure(error); }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    await authenticated(true);
    await deleteDocument(await idFor(context));
    return new Response(null, { status: 204, headers: privateHeaders });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    await authenticated(true);
    const attach = request.headers.get("slm-attachment");
    if (attach !== "true" && attach !== "false") throw new WorkspaceError("Choose an attachment state.");
    await attachDocument(await idFor(context), attach === "true");
    return new Response(null, { status: 204, headers: privateHeaders });
  } catch (error) { return failure(error); }
}
