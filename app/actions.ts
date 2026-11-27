"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { claim, createSession, getAdmin, sessionCookie, sessionDuration, verifyPassword } from "@/lib/auth";

const passwordSchema = z.string().min(12).max(128);

async function setSession(admin: NonNullable<Awaited<ReturnType<typeof getAdmin>>>) {
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  const secure = origin?.startsWith("https://") || requestHeaders.get("x-forwarded-proto") === "https";
  (await cookies()).set(sessionCookie, createSession(admin), {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: sessionDuration,
  });
}

export async function claimInstance(_previous: string, form: FormData) {
  if (await getAdmin()) redirect("/login");
  const code = z.string().trim().regex(/^[\w-]{32}$/).safeParse(form.get("code"));
  const password = passwordSchema.safeParse(form.get("password"));
  if (!password.success) return "Choose a password between 12 and 128 characters.";
  if (!code.success) return "Enter the pairing code from the container.";
  const admin = await claim(code.data, password.data);
  if (!admin) return "The pairing code was rejected or this instance has already been claimed.";
  await setSession(admin);
  redirect("/assistant");
}

export async function signIn(_previous: string, form: FormData) {
  const admin = await getAdmin();
  if (!admin) redirect("/setup");
  const password = passwordSchema.safeParse(form.get("password"));
  if (!password.success || !await verifyPassword(admin, password.data)) return "The password was rejected.";
  await setSession(admin);
  redirect("/assistant");
}

export async function signOut() {
  (await cookies()).delete(sessionCookie);
  redirect("/login");
}
