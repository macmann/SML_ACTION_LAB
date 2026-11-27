import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireAdmin();
  redirect("/assistant");
}
