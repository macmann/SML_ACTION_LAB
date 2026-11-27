import { DocumentWorkspace } from "@/components/document-workspace";
import { requireAdmin } from "@/lib/access";
import { store } from "@/lib/bootstrap.mjs";
import { defaultPreferences, settingsFrom } from "@/lib/settings";

export const metadata = { title: "Documents" };

export default async function DocumentsPage() {
  await requireAdmin();
  const settings = settingsFrom(await store.load());
  return <DocumentWorkspace maxMiB={Math.min(64, settings.preferences?.uploadMiB ?? defaultPreferences.uploadMiB)} />;
}
