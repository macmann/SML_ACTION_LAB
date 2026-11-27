import { authenticated, failure, json } from "@/lib/document-api";
import { boundedJson } from "@/lib/agent-input";
import { businessListing, businessCommand, updateBusiness } from "@/lib/business";
import { WorkspaceError } from "@/lib/database";

export const dynamic = "force-dynamic";
export async function GET() {
  try { await authenticated(); return json(await businessListing()); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    await authenticated(true);
    const command = businessCommand.safeParse(await boundedJson(request));
    if (!command.success) throw new WorkspaceError("Check the required values, dates, currency and confirmation.");
    return json(await updateBusiness(command.data));
  } catch (error) { return failure(error); }
}
