import { getAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  let setup: "claimed" | "unclaimed" | "unavailable";
  try {
    setup = await getAdmin() ? "claimed" : "unclaimed";
  } catch {
    setup = "unavailable";
  }
  return Response.json(
    { status: "not_ready", setup, database: "not_configured", provider: "not_configured" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
