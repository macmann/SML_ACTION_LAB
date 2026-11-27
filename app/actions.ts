"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentAdmin, requireSameOrigin, sessionCookie, setSession } from "@/lib/auth";
import { store } from "@/lib/bootstrap.mjs";
import { workspaceDestination } from "@/lib/settings";

const passwordSchema = z.string().min(12).max(128);

export async function claimInstance(_previous: string, form: FormData) {
  if (!await requireSameOrigin()) return "The request origin was rejected.";
  if ((await store.load()).admin) redirect("/login");
  const code = z.string().trim().regex(/^[\w-]{43}$/).safeParse(form.get("code"));
  const password = passwordSchema.safeParse(form.get("password"));
  if (!password.success) return "Choose a password between 12 and 128 characters.";
  let epoch;
  try {
    epoch = await store.authenticate("claim", password.data, code.success ? code.data : "");
  } catch {
    return "Setup is temporarily busy. Try again shortly.";
  }
  if (!epoch) return "The pairing token was rejected, expired, or rate limited.";
  await setSession(epoch);
  redirect("/settings");
}

export async function signIn(_previous: string, form: FormData) {
  if (!await requireSameOrigin()) return "The request origin was rejected.";
  if (!(await store.load()).admin) redirect("/setup");
  const password = passwordSchema.safeParse(form.get("password"));
  let epoch;
  try {
    epoch = await store.authenticate("login", password.success ? password.data : "");
  } catch {
    return "Sign-in is temporarily busy. Try again shortly.";
  }
  if (!epoch) return "The password was rejected or sign-in was rate limited.";
  await setSession(epoch);
  redirect(workspaceDestination(await store.load()));
}

export async function signOut() {
  if (!await requireSameOrigin()) return;
  const state = await currentAdmin();
  if (state) await store.revoke(state.admin.epoch);
  (await cookies()).set(sessionCookie, "", { secure: true, httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  redirect("/login");
}

export async function changePassword(_previous: string, form: FormData) {
  if (!await requireSameOrigin()) return "The request origin was rejected.";
  const state = await currentAdmin();
  if (!state) return "Sign in again to change the password.";
  const current = passwordSchema.safeParse(form.get("current"));
  const replacement = passwordSchema.safeParse(form.get("replacement"));
  if (!replacement.success) return "Choose a password between 12 and 128 characters.";
  let epoch;
  try {
    epoch = await store.changePassword(state.admin.epoch, current.success ? current.data : "", replacement.data);
  } catch {
    return "Password rotation is temporarily busy. Try again shortly.";
  }
  if (!epoch) return "The current password was rejected or the operation was rate limited.";
  await setSession(epoch);
  return "Password changed and previous sessions revoked.";
}
