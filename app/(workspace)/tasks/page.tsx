import { requireAdmin } from "@/lib/access";
import { BusinessWorkspace } from "@/components/business-workspace";

export const metadata = { title: "Tasks and notes" };
export default async function TasksPage() {
  await requireAdmin();
  return <BusinessWorkspace view="tasks" />;
}
