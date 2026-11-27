import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/access";
import { store } from "@/lib/bootstrap.mjs";
import { workspaceDestination } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireAdmin();
  redirect(workspaceDestination(await store.load()));
}
