import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthPanel } from "@/components/auth-panel";
import { accessState } from "@/lib/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "First-run setup" };

export default async function Setup() {
  const state = await accessState();
  if (state !== "unclaimed") redirect(state === "authenticated" ? "/" : "/login");
  return (
    <AuthPanel title="Claim this instance">
      <p className="text-[var(--muted)]">Create the single administrator account. Generate a pairing token in a private app container terminal. It expires after 15 minutes.</p>
      <code className="rounded-md bg-[var(--page)] p-3 text-sm break-all">node scripts/operator.mjs pair</code>
      <AuthForm setup />
    </AuthPanel>
  );
}
