import { Readable } from "node:stream";
import { authenticated, failure, privateHeaders } from "@/lib/document-api";
import { uuid } from "@/lib/document-files";
import { downloadDocument } from "@/lib/documents";
import { WorkspaceError } from "@/lib/database";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await authenticated();
    const { id } = await context.params;
    if (!uuid.test(id)) throw new WorkspaceError("Document not found.", 404);
    const { file, filename, size } = await downloadDocument(id.toLowerCase());
    const name = encodeURIComponent(filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16));
    return new Response(Readable.toWeb(file.createReadStream()) as ReadableStream<Uint8Array>, { headers: {
      ...privateHeaders,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": "attachment; filename*=UTF-8''" + name,
    } });
  } catch (error) { return failure(error); }
}
