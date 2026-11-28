import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { dataRoot } from "./data.mjs";
import { store } from "./bootstrap.mjs";
import { operationEvents, recordOperation } from "./operations.mjs";
import { DatabaseDiagnosticError, databaseIdentity, databaseIssue, databaseStep, permissionChecks, expectedVersions, migrationRegistryAvailable, inspectSchema, schemaBlockers, withDatabase } from "./database";
import { indexDiagnostics } from "./documents";
import { readiness, settingsFrom, defaultSpeech, roles, type Role, type Settings } from "./settings";
import { speechCapabilities } from "./speech-native.mjs";
import { storageCapacity } from "./storage-capacity";
import { testEndpointPolicy } from "./probes";
import { version } from "../package.json";
import { hash } from "./tool-registry.mjs";

type ProviderDetails = {
  configured: boolean; enabled?: boolean; endpointPolicy?: string; credentialConfigured?: boolean;
  credentialDecryptable?: boolean | null; model?: string; validationMode?: string;
  lastValidation?: NonNullable<Settings[Role]>["validation"] | null;
  lastValidationFailure?: unknown; lastHttpStatus?: number | null; lastSuccessfulInference?: string | null;
  lastInferenceError?: unknown; modelDiscovery?: string; chatCompletion?: string; toolCalling?: string;
  identity?: string; availability?: string;
};

async function paths() {
  return Object.fromEntries(await Promise.all(["", "config", "files", "artifacts", "models", "tmp"].map(async (name) => {
    const path = join(/* turbopackIgnore: true */ dataRoot, name);
    const [readable, writable] = await Promise.all([constants.R_OK | constants.X_OK, constants.W_OK | constants.X_OK]
      .map((mode) => access(path, mode).then(() => true, () => false)));
    return [name || "root", { path, readable, writable }] as const;
  })));
}

export async function diagnostics() {
  const checkedAt = new Date().toISOString();
  const settings = settingsFrom(await store.load());
  const generation = settings.databaseGeneration ?? 1;
  const directoryAccess = await paths();
  const events = await operationEvents();
  const setup = await readiness().catch(() => ({ status: "unavailable" }));
  const [speech, storage, providerDetails] = await Promise.all([
    speechCapabilities(settings.speechSettings ?? defaultSpeech),
    storageCapacity().then((capacity) => ({ status: "available", ...capacity })).catch(() => ({ status: "unavailable" })),
    Promise.all(roles.map(async (role): Promise<readonly [Role, ProviderDetails]> => {
      const provider = settings[role];
      if (!provider) return [role, { configured: false }] as const;
      const decryptable = provider.key ? await store.decrypt(role, provider.key).then(() => true, () => false) : null;
      let policy = "passed";
      try {
        const endpoint = await store.decrypt(role + ".endpoint", provider.endpoint);
        await testEndpointPolicy(endpoint, provider.custom, provider.privateNetwork);
      } catch { policy = "Endpoint could not be decrypted or did not pass HTTPS, DNS or address policy."; }
      const inference = events.filter((event) => event.component === "inference" && event.role === role &&
        event.configuration === hash(provider));
      const lastValidationFailure = events.find((event) => event.component === "provider" && event.role === role);
      const live = inference[0];
      return [role, { configured: true, enabled: role !== "distil" || settings.providerChoice !== "skipped",
        endpointPolicy: policy, credentialConfigured: Boolean(provider.key), credentialDecryptable: decryptable,
        model: provider.model, validationMode: provider.validationMode ?? "automatic", lastValidation: provider.validation ?? null,
        lastValidationFailure: lastValidationFailure?.type === "validation_failed" ? lastValidationFailure : null,
        lastHttpStatus: live ? live.httpStatus ?? null : provider.validation?.httpStatus ?? null,
        lastSuccessfulInference: inference.find((event) => event.type === "completed")?.timestamp ?? null,
        lastInferenceError: inference.find((event) => event.error) ?? null,
        modelDiscovery: provider.validation?.method === "discovery" ? "passed" :
          provider.validation?.discoveryStatus ? "unavailable (HTTP " + provider.validation.discoveryStatus + ")" : "not_tested",
        chatCompletion: provider.validation?.method === "chat" || inference.some((event) => event.type === "completed") ? "passed" : "not_tested",
        toolCalling: inference.some((event) => event.validToolCall) ? "passed" : "not_tested",
        identity: inference.find((event) => event.validToolCall)?.identity ?? "not_tested",
        availability: policy !== "passed" || decryptable === false ? "blocked" :
          live?.error ? "last_request_failed" : provider.validation || live ? "previously_verified" : "not_tested",
      }] as const;
    })),
  ]);
  const providers = Object.fromEntries<ProviderDetails>(providerDetails);
  const decryptable = settings.database
    ? await store.decrypt("database", settings.database).then(() => true, () => false) : null;
  const started = Date.now();
  let identity: Awaited<ReturnType<typeof databaseIdentity>> | undefined;
  let schema: Awaited<ReturnType<typeof inspectSchema>> | undefined;
  let selectOne = false;
  let connected = false;
  let error: string | null = null;
  let failureDetail: DatabaseDiagnosticError["diagnostic"] | null = null;
  const issue = (category: DatabaseDiagnosticError["diagnostic"]["category"], stage: string, message: string) =>
    ({ category, stage, message, durationMs: Date.now() - started });
  if (settings.database && decryptable) {
    try {
      await withDatabase(async (pool, actualGeneration) => {
        if (actualGeneration !== generation) throw new DatabaseDiagnosticError("connection_failure", "Check configured generation", "Database settings changed. Refresh diagnostics.", Date.now() - started);
        const client = await databaseStep("connection_failure", "Connect to PostgreSQL", "database.connect", () => pool.connect());
        connected = true;
        try {
          await databaseStep("sql_execution_failure", "Test SELECT 1", "database.ping", () => client.query("SELECT 1"));
          selectOne = true;
          identity = await databaseIdentity(client);
          if (identity?.schemaExists && !identity.schemaUsage) {
            const denied = permissionChecks(identity).find(({ name }) => name === "USAGE on slm_workspace");
            error = denied?.explanation ?? "The app login needs USAGE on slm_workspace.";
            failureDetail = issue("permission_policy_rejection", "Check workspace schema access", error);
          } else {
            schema = await inspectSchema(client);
          }
        } finally { client.release(); }
      });
    } catch (failure) {
      error = databaseIssue(failure);
      failureDetail = failure instanceof DatabaseDiagnosticError ? failure.diagnostic :
        issue(connected ? "workspace_readiness_failure" : "connection_failure", "Check workspace readiness", error);
    }
  } else if (settings.database) {
    error = "Database credentials could not be decrypted. Restore the original config and keys together.";
    failureDetail = issue("connection_failure", "Decrypt database credentials", error);
  }
  if (settings.database) await recordOperation("database", selectOne ? "connection_verified" : "connection_failed",
    { generation, durationMs: Date.now() - started, ...(error ? { error, diagnostic: failureDetail } : {}) });
  const blockers = !settings.database ? ["Save a PostgreSQL connection on the Database tab."] :
    error ? [error] : schema ? schemaBlockers(schema) : ["Workspace schema could not be inspected."];
  if (!failureDetail && schema && !schema.ready && blockers.length) {
    failureDetail = issue("workspace_readiness_failure", "Verify workspace schema", blockers.join(" "));
  }
  const database = !settings.database ? "not_configured" : !selectOne ? "unavailable" :
    schema?.ready ? "ready" : schema?.pending?.length ? "migrations_required" : "schema_unavailable";
  const storageBlockers = ["files", "artifacts"].filter((folder) =>
    !directoryAccess[folder].readable || !directoryAccess[folder].writable
  ).map((folder) => "Check app ownership and permissions for the " + folder + " directory.");
  if (storage.status !== "available") storageBlockers.push("Check that the document storage directories can be inspected.");
  await recordOperation("workspace", "readiness_checked", { generation, status: database, durationMs: Date.now() - started });
  const byRole = Object.fromEntries(roles.map((role) => {
    const provider = providers[role];
    const reasons = !provider.configured || provider.enabled === false ? ["Configure and enable " + role + " on the Model providers tab."] :
      provider.availability === "blocked" ? ["Check the " + role + " endpoint and credential on the Model providers tab."] : [];
    const audit = schema?.ready && !schema.auditWritable
      ? ["Grant INSERT and UPDATE on inference_logs for Assistant requests."] : [];
    return [role, { ready: blockers.length === 0 && reasons.length === 0 && audit.length === 0 &&
        provider.availability !== "last_request_failed",
      blockers: [...blockers, ...reasons, ...audit],
      warning: provider.availability === "last_request_failed" ? "The last inference attempt failed. Verify the endpoint before retrying." : null }];

  }));
  const migrationEvents = events.filter((event) => event.component === "migration" &&
    (event.generation === generation || event.generation === undefined));
  return {
    checkedAt, setup, database, speech, storage, providers,
    index: database === "ready" ? indexDiagnostics(generation) : { status: "unavailable" },
    application: { version, commit: process.env.SLM_BUILD_COMMIT ?? null, buildTimestamp: process.env.SLM_BUILD_TIMESTAMP ?? null,
      environment: process.env.NODE_ENV ?? "development", node: process.version, uptimeSeconds: Math.floor(process.uptime()),
      lastStartup: events.find((event) => event.type === "startup")?.timestamp ??
        new Date(Date.now() - process.uptime() * 1000).toISOString(),
      configAvailable: directoryAccess.config.readable && directoryAccess.config.writable,
      volumeAvailable: directoryAccess.root.readable && directoryAccess.root.writable },
    connectivity: { configured: Boolean(settings.database), generation, credentialsDecryptable: decryptable, connected, selectOne,
      target: identity ?? null,
      permissions: identity ? permissionChecks(identity, schema?.pending ? schema.pending.length > 0 : null) : null,
      failure: failureDetail, latencyMs: settings.database ? Date.now() - started : null,
      lastSuccessfulConnection: selectOne ? checkedAt : events.find((event) =>
        event.type === "connection_verified" && event.generation === generation)?.timestamp ?? null,
      currentError: error, lastError: error ?? events.find((event) => event.type === "connection_failed" && event.generation === generation)?.error ?? null },
    migrations: { mechanism: "Transactional PostgreSQL SQL registry and checksum ledger",
      registryAvailable: migrationRegistryAvailable, expectedVersions,
      applied: schema?.applied ?? null, pending: schema?.pending ?? null, ledgerCompatible: schema?.ledgerCompatible ?? null,
      missingTables: schema?.missingTables ?? null, inaccessibleTables: schema?.inaccessibleTables ?? null,
      writeRestrictedTables: schema?.writeRestrictedTables ?? null,
      requiredVersion: expectedVersions.at(-1) ?? null, actualVersion: schema ? schema.applied.at(-1)?.version ?? 0 : null,
      lastAttempt: migrationEvents[0] ?? null, failures: migrationEvents.filter((event) => event.type === "failed").slice(0, 10) },
    workspace: { ready: blockers.length === 0 && storageBlockers.length === 0 && database === "ready",
      schemaInitialized: Boolean(schema?.installation), migrationsComplete: schema ? schema.pending?.length === 0 && schema.ledgerCompatible : null,
      requiredTablesExist: schema ? schema.missingTables.length === 0 : null,
      documentStorageReady: storageBlockers.length === 0,
      modelStorageReady: directoryAccess.models.readable && directoryAccess.models.writable,
      blockers: [...blockers, ...storageBlockers], assistant: byRole },
    directories: directoryAccess,
  };
}
