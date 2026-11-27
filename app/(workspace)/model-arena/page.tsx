import { requireAdmin } from "@/lib/access";
import { ModelArena } from "@/components/model-arena";

export const metadata = { title: "Model Arena" };
export default async function ArenaPage() {
  await requireAdmin();
  return <ModelArena />;
}
