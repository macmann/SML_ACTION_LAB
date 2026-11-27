import { requireAdmin } from "@/lib/access";
import { BusinessWorkspace } from "@/components/business-workspace";
import { uuid } from "@/lib/document-files";

export const metadata = { title: "Invoices" };
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  await requireAdmin();
  const { source } = await searchParams;
  return <BusinessWorkspace key={source ?? "manual"} view="invoices" source={source && uuid.test(source) ? source : undefined} />;
}
