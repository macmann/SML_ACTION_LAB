import { cookies, headers } from "next/headers";
import { sessionDuration, store } from "./bootstrap.mjs";

export const sessionCookie = "__Host-slm_session";

export async function currentAdmin() {
  const state = await store.load();
  const token = (await cookies()).get(sessionCookie)?.value;
  return await store.validSession(state, token) ? state : null;
}

export async function requireSameOrigin() {
  const request = await headers();
  const origin = request.get("origin");
  const host = request.get("x-forwarded-host") ?? request.get("host");
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return url.origin === origin && url.host === host.toLowerCase() &&
      (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  } catch {
    return false;
  }
}

export async function setSession(epoch: string) {
  (await cookies()).set(sessionCookie, await store.createSession(epoch), {
    httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: sessionDuration,
  });
}
