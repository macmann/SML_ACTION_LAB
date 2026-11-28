"use server";

import { z } from "zod";
import { currentAdmin, requireSameOrigin } from "@/lib/auth";
import { store } from "@/lib/bootstrap.mjs";
import { preferences, roles, settingsFrom, speechSettings } from "@/lib/settings";
import { testDatabase, testProvider, ProviderValidationError, validationModes } from "@/lib/probes";
import { closeDatabase, databaseLane, migrateWorkspace, WorkspaceError } from "@/lib/database";
import { importedProfile } from "@/lib/model-profile";
import { revalidatePath } from "next/cache";

const value = (form: FormData, field: string) => {
  const raw = form.get(field);
  return typeof raw === "string" ? raw.trim() : "";
};

export async function updateSettings(_previous: string, form: FormData) {
  if (!await requireSameOrigin()) return "The request origin was rejected.";
  const state = await currentAdmin();
  if (!state) return "Sign in again to change settings.";
  const settings = settingsFrom(state);
  if (value(form, "revision") !== String(state.revision)) return "Settings changed. Reload before saving.";
  const operation = value(form, "operation");
  let failureMessage = "Settings could not be prepared. Reload Settings and check that the app volume is accessible.";
  try {
    if (operation === "migrate") {
      if (form.get("dedicated") !== "on") return "Confirm that this database is dedicated to SLM Action Lab.";
      await migrateWorkspace();
      return "Workspace migrations applied.";
    }
    if (operation === "speech") {
      const speech = speechSettings.safeParse({ enabled: form.get("enabled") === "on", model: value(form, "model"),
        language: value(form, "language"), maxSeconds: Number(value(form, "maxSeconds")), readAloud: form.get("readAloud") === "on" });
      if (!speech.success) return "Check the local speech model, language and duration.";
      settings.speechSettings = speech.data;
    } else if (operation === "profile") {
      const raw = value(form, "metadata");
      if (!settings.distil || !raw || raw.length > 16_000) return "Enter metadata for the configured Distil model.";
      let profile;
      try { profile = importedProfile.safeParse(JSON.parse(raw)); }
      catch { return "Import a JSON object with the Distil model metadata."; }
      if (!profile.success || profile.data.modelId !== settings.distil.model) {
        return "Metadata must match the configured Distil model and v1 contract.";
      }
      if (profile.data.thinking === "on" && !settings.distil.custom) return "Thinking metadata requires a compatible custom endpoint.";
      settings.routingProfile = profile.data;
    } else if (operation === "database") {
      const input = value(form, "url");
      const old = settings.database ? await store.decrypt("database", settings.database) : "";
      const candidate = input || old;
      if (!candidate || candidate.length > 4096) return "Enter a valid PostgreSQL URL.";
      if (old && candidate !== old && form.get("confirm") !== "on") {
        return "Confirm the database replacement. Existing data will stay in the original database.";
      }
      try { await testDatabase(candidate); }
      catch { return "PostgreSQL connection test failed. Check the URL, TLS settings, credentials and network access from the app container."; }
      settings.database = await store.encrypt("database", candidate);
      if (candidate !== old) settings.databaseGeneration = (settings.databaseGeneration ?? 0) + 1;
    } else if (operation === "skip") {
      if (!settings.database) return "Configure PostgreSQL before finishing setup.";
      settings.providerChoice = "skipped";
    } else if (operation === "resume-provider") {
      if (!settings.database || !settings.distil) return "Test and save the Distil provider first.";
      const distil = settings.distil;
      await testProvider(await store.decrypt("distil.endpoint", distil.endpoint), distil.model,
        distil.key ? await store.decrypt("distil", distil.key) : "", distil.custom, distil.privateNetwork, distil.validationMode, form.get("chatConsent") === "on");
      settings.providerChoice = "configured";
    } else if (operation === "preferences") {
      const parsed = preferences.safeParse({
        timezone: value(form, "timezone"), speech: value(form, "speech"),
        uploadMiB: Number(value(form, "uploadMiB")), requestsPerMinute: Number(value(form, "requestsPerMinute")),
        shareDocuments: form.get("shareDocuments") === "on",
      });
      if (!parsed.success || parsed.data.uploadMiB > 64) return "Check the timezone, speech choice and numeric limits.";
      settings.preferences = parsed.data;
    } else {
      const role = z.enum(roles).safeParse(operation);
      if (!role.success) return "Unknown settings operation.";
      if (!settings.database) return "Configure PostgreSQL before saving a provider.";
      const name = role.data;
      const old = settings[name];
      if (value(form, "remove") === "on") {
        delete settings[name];
        if (name === "distil") delete settings.routingProfile;
        if (name === "distil" && settings.providerChoice === "configured") delete settings.providerChoice;
      } else {
        const endpoint = value(form, "endpoint") || (old ? await store.decrypt(name + ".endpoint", old.endpoint) : "");
        const providedKey = value(form, "key");
        // A blank replacement preserves the key only for the same destination.
        const previousEndpoint = old ? await store.decrypt(name + ".endpoint", old.endpoint) : "";
        if (old?.key && endpoint !== previousEndpoint && !providedKey && form.get("clearKey") !== "on") {
          return "Enter a replacement key or select clear key before changing the endpoint.";
        }
        const key = form.get("clearKey") === "on" ? "" :
          providedKey || (old?.key ? await store.decrypt(name, old.key) : "");
        const model = value(form, "model");
        if (!endpoint || endpoint.length > 2048 || key.length > 4096) {
          return "Enter a valid HTTPS base URL and check the API key length.";
        }
        const custom = form.get("custom") === "on";
        const privateNetwork = form.get("privateNetwork") === "on";
        const validationMode = z.enum(validationModes).safeParse(value(form, "validationMode") || "automatic");
        if (!validationMode.success) return "Choose a supported provider validation mode.";
        await testProvider(endpoint, model, key, custom, privateNetwork, validationMode.data, form.get("chatConsent") === "on");
        settings[name] = {
          endpoint: await store.encrypt(name + ".endpoint", endpoint),
          key: key ? await store.encrypt(name, key) : undefined,
          model, custom, privateNetwork, validationMode: validationMode.data,
        };
        if (name === "distil") {
          if (endpoint !== previousEndpoint || model !== old?.model) delete settings.routingProfile;
          settings.providerChoice = "configured";
        }
      }
    }
    failureMessage = "Settings storage could not be updated. Check the app volume permissions and free space, then retry.";
    const save = () => store.saveSettings(state.revision, state.admin.epoch, settings);
    const saved = await databaseLane(async () => {
      if (!await save()) return false;
      if (operation === "database") {
        failureMessage = "Database settings were saved, but the previous connection pool could not close. Retry the workspace connection.";
        await closeDatabase();
      }
      return true;
    });
    if (!saved) {
      return "The session or settings changed during testing. Reload and retry.";
    }
  } catch (error) {
    if (error instanceof WorkspaceError || error instanceof ProviderValidationError) return error.message;
    return failureMessage;
  }
  revalidatePath("/settings");
  return "Settings saved.";
}
