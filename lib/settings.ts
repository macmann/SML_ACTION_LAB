import { z } from "zod";
import { importedProfile } from "./model-profile";
import { validationModes } from "./probes";
import { store } from "./bootstrap.mjs";

export const roles = ["distil", "comparison", "writer"] as const;
export type Role = typeof roles[number];

const envelope = z.object({ version: z.literal(1), nonce: z.string(), data: z.string(), tag: z.string() });
const provider = z.object({
  endpoint: envelope, model: z.string(), key: envelope.optional(),
  custom: z.boolean(), privateNetwork: z.boolean(), validationMode: z.enum(validationModes).optional(),
  validation: z.object({ method: z.enum(["discovery", "chat"]), httpStatus: z.literal(200),
    discoveryStatus: z.number().optional(), checkedAt: z.string() }).optional(),
});

export const preferences = z.object({
  timezone: z.string().max(80).refine((zone) => {
    try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; }
  }),
  speech: z.enum(["off", "tiny", "base", "small"]),
  uploadMiB: z.number().int().min(1).max(256),
  requestsPerMinute: z.number().int().min(1).max(120),
  shareDocuments: z.boolean(),
});

export const speechSettings = z.strictObject({
  enabled: z.boolean(), model: z.enum(["off", "base"]),
  language: z.enum(["auto", "en", "de", "fr", "es", "it", "zh", "ja", "my"]),
  maxSeconds: z.number().int().min(5).max(60), readAloud: z.boolean(),
});
export const defaultSpeech = { enabled: false, model: "base", language: "auto", maxSeconds: 60, readAloud: false } as const;

const schema = z.object({
  database: envelope.optional(),
  databaseGeneration: z.number().int().positive().optional(),
  providerChoice: z.enum(["configured", "skipped"]).optional(),
  distil: provider.optional(), comparison: provider.optional(), writer: provider.optional(),
  preferences: preferences.optional(),
  speechSettings: speechSettings.optional(),
  routingProfile: importedProfile.optional(),
});

export type Settings = z.infer<typeof schema>;
export const defaultPreferences = { timezone: "UTC", speech: "off", uploadMiB: 25, requestsPerMinute: 12, shareDocuments: false } as const;

export function settingsFrom(state: { settings: unknown }): Settings {
  return schema.parse(state.settings);
}

export function workspaceDestination(state: { settings: unknown }) {
  const settings = settingsFrom(state);
  return settings.database && settings.providerChoice ? "/assistant" : "/settings";
}

export async function readiness() {
  const state = await store.load();
  const settings = settingsFrom(state);
  if (settings.database) await store.decrypt("database", settings.database);
  for (const role of roles) {
    const endpoint = settings[role]?.endpoint;
    if (endpoint) await store.decrypt(role + ".endpoint", endpoint);
    const key = settings[role]?.key;
    if (key) await store.decrypt(role, key);
  }
  const database = settings.database ? "configured" : "not_configured";
  const provider = settings.providerChoice ?? "not_configured";
  const stage = !state.admin ? "unclaimed" : !settings.database ? "claimed" :
    settings.providerChoice ? "ready" : "database_configured";
  return { status: stage === "ready" ? "ready" : "not_ready", setup: state.admin ? "claimed" : "unclaimed", database, provider, stage };
}
