import { requireAdmin } from "@/lib/access";
import { store } from "@/lib/bootstrap.mjs";
import { settingsFrom } from "@/lib/settings";
import { AssistantWorkspace } from "@/components/assistant-workspace";

export const metadata = { title: "Assistant" };

export default async function AssistantPage() {
  await requireAdmin();
  const settings = settingsFrom(await store.load());
  return <AssistantWorkspace writerModel={settings.writer?.model ?? null} shareEnabled={Boolean(settings.preferences?.shareDocuments)}
    comparisonConfigured={Boolean(settings.comparison)} routingConfigured={Boolean(settings.distil) && settings.providerChoice !== "skipped"} />;
}
