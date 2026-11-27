import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdmin, sessionCookie, validSession } from "./auth";

export async function accessState() {
  const admin = await getAdmin();
  if (!admin) return "unclaimed";
  return validSession(admin, (await cookies()).get(sessionCookie)?.value) ? "authenticated" : "claimed";
}

export async function requireAdmin() {
  const state = await accessState();
  if (state === "unclaimed") redirect("/setup");
  if (state === "claimed") redirect("/login");
}
