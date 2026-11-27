import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { configPath, createPrivateFile, readOptionalPrivateFile } from "./data.mjs";

export const sessionCookie = "slm_session";
export const sessionDuration = 8 * 60 * 60;
const derive = promisify(scrypt);
const adminPath = configPath("admin.json");
const adminSchema = z.object({
  salt: z.string().regex(/^[a-f0-9]{32}$/),
  passwordHash: z.string().regex(/^[a-f0-9]{128}$/),
  signingKey: z.string().regex(/^[a-f0-9]{64}$/),
});
type Admin = z.infer<typeof adminSchema>;

export async function getAdmin(): Promise<Admin | null> {
  const raw = await readOptionalPrivateFile(adminPath);
  if (raw === null) return null;
  try {
    return adminSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("The administrator configuration is invalid.");
  }
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function claim(code: string, password: string): Promise<Admin | null> {
  if (await getAdmin()) return null;
  const pairing = await readOptionalPrivateFile(configPath("pairing-code"));
  if (!pairing || !equal(code, pairing.trim())) return null;
  const salt = randomBytes(16).toString("hex");
  const admin = {
    salt,
    passwordHash: (await derive(password, salt, 64) as Buffer).toString("hex"),
    signingKey: randomBytes(32).toString("hex"),
  };
  return await createPrivateFile(adminPath, JSON.stringify(admin)) ? admin : null;
}

export async function verifyPassword(admin: Admin, password: string): Promise<boolean> {
  return equal((await derive(password, admin.salt, 64) as Buffer).toString("hex"), admin.passwordHash);
}

function sign(admin: Admin, payload: string): string {
  return createHmac("sha256", Buffer.from(admin.signingKey, "hex")).update(payload).digest("base64url");
}

export function createSession(admin: Admin): string {
  const payload = String(Math.floor(Date.now() / 1000) + sessionDuration) + "." + randomBytes(16).toString("hex");
  return payload + "." + sign(admin, payload);
}

export function validSession(admin: Admin, token: string | undefined): boolean {
  const match = token?.match(/^(\d{1,12})\.([a-f0-9]{32})\.([\w-]{43})$/);
  return !!match && Number(match[1]) > Date.now() / 1000 && equal(match[3], sign(admin, match[1] + "." + match[2]));
}
