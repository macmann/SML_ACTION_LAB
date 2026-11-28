import { authenticated, failure, json } from "@/lib/document-api";
import { withDatabase, workspaceId } from "@/lib/database";
import { indexDiagnostics } from "@/lib/documents";
import { readiness, settingsFrom, defaultSpeech, roles } from "@/lib/settings";
import { speechCapabilities } from "@/lib/speech-native.mjs";
import { storageCapacity } from "@/lib/storage-capacity";
import { store } from "@/lib/bootstrap.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await authenticated();
    const settings = settingsFrom(await store.load());
    const [setup, speech, storage, database] = await Promise.all([
      readiness(),
      speechCapabilities(settings.speechSettings ?? defaultSpeech),
      storageCapacity().then((capacity) => ({ status: "available", ...capacity })).catch(() => ({ status: "unavailable" })),
      settings.database ? withDatabase(async (pool) => {
        await pool.query("SELECT 1");
        try { await workspaceId(pool); return "ready"; }
        catch (error) {
          const code = (error as { code?: string }).code;
          if (code === "42P01" || code === "3F000" || (error instanceof Error && error.message.startsWith("Run the workspace migrations"))) {
            return "migrations_required";
          }
          return "schema_unavailable";
        }
      }).catch(() => "unavailable") : "not_configured",
    ]);
    return json({ setup, database, speech, storage,
      providers: Object.fromEntries(roles.map((role) => [role, settings[role] ? "configured" : "not_configured"])),
      index: database === "ready" ? indexDiagnostics(settings.databaseGeneration ?? 1) : { status: "unavailable" },
    });
  } catch (error) { return failure(error); }
}
