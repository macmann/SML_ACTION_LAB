import { authenticated, failure, json, searchOptions, uploadMetadata } from "@/lib/document-api";
import { listDocuments, uploadDocument } from "@/lib/documents";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await authenticated();
    return json(await listDocuments(searchOptions(new URL(request.url))));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    await authenticated(true);
    return json(await uploadDocument(request, uploadMetadata(request.headers.get("slm-upload"))), 201);
  } catch (error) { return failure(error); }
}
