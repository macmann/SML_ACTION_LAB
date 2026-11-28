import { authenticated, failure, json } from "@/lib/document-api";
import { diagnostics } from "@/lib/diagnostics";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await authenticated();
    return json(await diagnostics());
  } catch (error) { return failure(error); }
}
