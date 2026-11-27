import { authenticated, failure, json } from "@/lib/document-api";
import { WorkspaceError } from "@/lib/database";
import { uuid } from "@/lib/document-files";
import { previewDocument } from "@/lib/documents";
import { evidencedField } from "@/lib/evidence.mjs";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await authenticated();
    const source = new URL(request.url).searchParams.get("source");
    if (!source || !uuid.test(source)) throw new WorkspaceError("Choose a valid source document.");
    const document = await previewDocument(source);
    return json({ source, title: document.title, fields: Object.fromEntries(
      ["invoice_id", "invoice_date", "due_date", "amount", "currency", "customer"].map((key) => [key, evidencedField(document.sections, key)])) });
  } catch (error) { return failure(error); }
}
