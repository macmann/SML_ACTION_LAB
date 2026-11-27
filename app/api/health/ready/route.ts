import { readiness } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await readiness();
    return Response.json(state, { status: state.status === "ready" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { status: "not_ready", setup: "unavailable", database: "unavailable", provider: "unavailable", stage: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
