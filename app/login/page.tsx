import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthPanel } from "@/components/auth-panel";
import { accessState } from "@/lib/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin sign-in" };

export default async function Login() {
  const state = await accessState();
  if (state !== "claimed") redirect(state === "authenticated" ? "/assistant" : "/setup");
  return <AuthPanel title="Admin sign-in"><AuthForm /></AuthPanel>;
}
