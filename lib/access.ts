import { redirect } from "next/navigation";
import { currentAdmin } from "./auth";
import { store } from "./bootstrap.mjs";

export async function accessState() {
  if (!(await store.load()).admin) return "unclaimed";
  return await currentAdmin() ? "authenticated" : "claimed";
}

export async function requireAdmin() {
  const state = await accessState();
  if (state === "unclaimed") redirect("/setup");
  if (state === "claimed") redirect("/login");
}
