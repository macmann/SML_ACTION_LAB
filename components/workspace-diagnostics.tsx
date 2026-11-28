"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SettingsForm } from "./settings-form";
import type { diagnostics } from "@/lib/diagnostics";

type Report = Awaited<ReturnType<typeof diagnostics>>;
type Status = "PASS" | "FAIL" | "WARNING" | "NOT CONFIGURED" | "NOT TESTED";
type Check = { label: string; status: Status; value?: unknown; action?: string };
const check = (label: string, value: unknown, action?: string): Check => ({
  label, value, status: value == null ? "NOT TESTED" : value === false ? "FAIL" : "PASS", action,
});
const group = "grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4";

function Checks({ title, items }: { title: string; items: Check[] }) {
  return <section className={group}>
    <h2 className="text-lg font-semibold">{title}</h2>
    <dl className="divide-y divide-[var(--line)]">
      {items.map(({ label, value, status, action }) => <div key={label} className="grid gap-1 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <dt className="font-medium">{label}</dt>
        <dd className="min-w-0 wrap-anywhere">
          <span className="font-semibold">{status}</span>
          {value != null && typeof value !== "boolean" && <div className="whitespace-pre-wrap">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</div>}
          {(status === "FAIL" || status === "WARNING") && action && <div className="text-[var(--muted)]">{action}</div>}
        </dd>
      </div>)}
    </dl>
  </section>;
}

export function WorkspaceDiagnostics({ revision, configured }: { revision: number; configured: boolean }) {
  const [report, setReport] = useState<Report>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (message = "") => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/diagnostics", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setReport(await response.json());
      setNotice(message);
    } catch { setNotice("Diagnostics could not be refreshed. Sign in again or check app storage."); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const file = report ? JSON.stringify(report, null, 2) : "";
  const dbAction = "Review the target, network, TLS, or restricted database login on the Database tab.";
  const schemaAction = "Review the migration details and required grants before running pending migrations.";
  const download = () => {
    const url = URL.createObjectURL(new Blob([file], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "slm-diagnostics.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <div className="grid min-w-0 gap-4">
    <section className={group}>
      <h2 className="text-xl font-semibold">Workspace diagnostics</h2>
      <p>Checks inspect the current configuration and database. Provider checks resolve the endpoint and read prior observations. The Model providers tab can send a fixed chat test with your consent.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => void refresh()}>Refresh diagnostics</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void refresh("Database connection check finished.")}>Test database connection</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void refresh("Migration status check finished.")}>Check migration status</Button>
        <Button type="button" variant="outline" disabled={!report} onClick={async () => {
          try { await navigator.clipboard.writeText(file); setNotice("Sanitized diagnostics copied."); }
          catch { setNotice("Clipboard unavailable. Use Download sanitized diagnostics JSON."); }
        }}>Copy sanitized diagnostics JSON</Button>
        <Button type="button" variant="outline" disabled={!report} onClick={download}>Download sanitized diagnostics JSON</Button>
      </div>
      <p role="status">{busy ? "Checking current workspace…" : notice}</p>
      <p className="text-sm">Last checked {report?.checkedAt ?? "pending"}</p>
      {report && <div className="grid gap-1">
        <strong>{report.workspace.ready ? "PASS · Workspace ready" : "FAIL · Workspace blocked"}</strong>
        {report.workspace.blockers.map((reason) => <p key={reason}>{reason}</p>)}
        {!report.workspace.ready && <Link className="underline" href="/settings?tab=database">Open database settings</Link>}
      </div>}
      {configured && <SettingsForm operation="migrate" revision={revision} submit="Run pending migrations" onResult={() => void refresh()}>
        <label className="flex items-start gap-2"><input type="checkbox" name="dedicated" required className="mt-1" />
          <span>I confirm this is a dedicated database with a restricted application login.</span>
        </label>
      </SettingsForm>}
    </section>
    {report && <>
      <Checks title="Application" items={[
        check("Application version", report.application.version),
        check("Git commit", report.application.commit), check("Build timestamp", report.application.buildTimestamp),
        check("Runtime environment", report.application.environment), check("Node.js", report.application.node),
        check("Uptime", report.application.uptimeSeconds + " seconds"), check("Last startup", report.application.lastStartup),
        check("Configuration storage", report.application.configAvailable, "Check config ownership and app-volume permissions."),
        check("Persistent volume", report.application.volumeAvailable, "Verify the persistent volume mount and app UID."),
      ]} />
      <Checks title="Database connectivity" items={[
        { label: "Database configured", status: report.connectivity.configured ? "PASS" : "NOT CONFIGURED" },
        check("Credential decryption", report.connectivity.credentialsDecryptable, "Restore the original config and encryption keys together."),
        check("PostgreSQL connected", report.connectivity.configured ? report.connectivity.connected : null, dbAction),
        check("SELECT 1", report.connectivity.connected ? report.connectivity.selectOne : null, dbAction),
        check("Database / login / current schema", report.connectivity.target ? {
          database: report.connectivity.target.database, login: report.connectivity.target.username, schema: report.connectivity.target.schema,
        } : null),
        check("Workspace schema usage", report.connectivity.target?.schemaExists ? report.connectivity.target.schemaUsage : null, schemaAction),
        ...report.connectivity.permissions?.map(({ name, expected, actual, passed, explanation }): Check => ({
          label: name, status: passed ? "PASS" : "FAIL",
          value: `Expected: ${expected} · Actual: ${actual}\n${passed ? "Meets migration policy." : explanation}`,
        })) ?? [{ label: "Restricted login permission predicates", status: "NOT TESTED" as const }],
        check("Public schema ownership and privileges", report.connectivity.target ? {
          literalOwner: report.connectivity.target.publicOwner,
          effectiveOwner: report.connectivity.target.publicEffectiveOwner,
          usage: report.connectivity.target.publicUsage, create: report.connectivity.target.publicCreate,
          databaseOwner: report.connectivity.target.databaseOwner,
        } : null),
        check("DDL permissions and schema ownership", report.connectivity.target ? {
          databaseCreate: report.connectivity.target.databaseCreate, schemaCreate: report.connectivity.target.schemaCreate,
          schemaOwner: report.connectivity.target.schemaOwner,
        } : null),
        { label: "Current diagnostic failure", status: report.connectivity.failure ? "FAIL" : report.connectivity.selectOne ? "PASS" : "NOT TESTED",
          value: report.connectivity.failure, action: dbAction },
        check("Probe duration", report.connectivity.latencyMs == null ? null : report.connectivity.latencyMs + " ms"),
        check("Last successful connection", report.connectivity.lastSuccessfulConnection),
        { label: "Last database error", status: report.connectivity.currentError ? "FAIL" : report.connectivity.lastError ? "WARNING" : report.connectivity.selectOne ? "PASS" : "NOT TESTED",
          value: report.connectivity.lastError, action: dbAction },
      ]} />
      <Checks title="Workspace migrations" items={[
        check("Migration mechanism", report.migrations.mechanism),
        check("Bundled migration registry", report.migrations.registryAvailable, "Rebuild the image from the complete application source."),
        check("Expected versions", report.migrations.expectedVersions),
        check("Required / actual version", report.migrations.actualVersion !== null ? {
          required: report.migrations.requiredVersion, actual: report.migrations.actualVersion,
        } : null),
        check("Applied migrations", report.migrations.applied),
        { label: "Pending migrations", status: report.migrations.pending == null ? "NOT TESTED" : report.migrations.pending.length ? "WARNING" : "PASS",
          value: report.migrations.pending, action: schemaAction },
        { label: "Tables with restricted write grants", status: report.migrations.writeRestrictedTables == null ? "NOT TESTED" :
          report.migrations.writeRestrictedTables.length ? "WARNING" : "PASS", value: report.migrations.writeRestrictedTables,
          action: "Review least-privilege grants for the operations this app login needs." },
        check("Ledger checksums", report.migrations.ledgerCompatible, "Verify the database target and use a matching backup or release."),
        { label: "Missing required tables", status: report.migrations.missingTables == null ? "NOT TESTED" :
          report.migrations.missingTables.length ? "FAIL" : "PASS", value: report.migrations.missingTables, action: schemaAction },
        { label: "Last migration attempt", status: !report.migrations.lastAttempt ? "NOT TESTED" :
          report.migrations.lastAttempt.type === "failed" ? "FAIL" : "PASS", value: report.migrations.lastAttempt, action: schemaAction },
        { label: "Recent failed attempts", status: report.migrations.failures.length ? "WARNING" : "PASS",
          value: report.migrations.failures, action: schemaAction },
      ]} />
      <Checks title="Workspace readiness" items={[
        check("Installation initialized", report.workspace.schemaInitialized, schemaAction),
        check("Migrations complete", report.workspace.migrationsComplete, schemaAction),
        check("Required tables present", report.workspace.requiredTablesExist, schemaAction),
        ...Object.entries(report.workspace.assistant).map(([role, result]) =>
          ({ label: "Assistant / " + role, status: result.ready ? "PASS" : result.warning && !result.blockers.length ? "WARNING" : "FAIL", value: [...result.blockers, result.warning].filter(Boolean).join(" "),
            action: "Review the database checks or open the Model providers tab." }) as Check),
      ]} />
      {Object.entries(report.providers).map(([role, provider]) => <Checks key={role} title={"Model provider · " + role} items={[
        { label: "Provider configured", status: provider.configured ? "PASS" : "NOT CONFIGURED", value: provider.model },
        check("API credential configured", provider.credentialConfigured === false ? null : provider.credentialConfigured),
        check("API credential decryption", provider.credentialDecryptable, "Restore the original keys or replace the credential."),
        { label: "Endpoint policy", status: provider.endpointPolicy === "passed" ? "PASS" : provider.configured ? "FAIL" : "NOT CONFIGURED",
          value: provider.endpointPolicy, action: "Check the provider URL, custom-endpoint opt-in, and outbound DNS." },
        check("Last successful validation", provider.lastValidation), { label: "Last HTTP status", status: provider.lastHttpStatus == null ? "NOT TESTED" : provider.lastHttpStatus === 200 ? "PASS" : "FAIL", value: provider.lastHttpStatus,
          action: "Check the role's last inference or validation error on this page." },
        check("Last successful inference", provider.lastSuccessfulInference),
        { label: "Last validation failure", status: provider.lastValidationFailure ? "FAIL" : "NOT TESTED",
          value: provider.lastValidationFailure, action: "Use the Model providers tab to verify credentials and the exact model ID." },
        { label: "Last inference error", status: provider.lastInferenceError ? "WARNING" : "NOT TESTED",
          value: provider.lastInferenceError, action: "Verify the configured endpoint with explicit consent before retrying." },
        ...[["Model discovery", provider.modelDiscovery], ["Chat completion", provider.chatCompletion], ["Tool calling", provider.toolCalling]]
          .map(([label, value]) => ({ label, status: value === "passed" ? "PASS" : value?.startsWith("unavailable") ? "WARNING" : "NOT TESTED",
            value: value === "not_tested" ? null : value, action: "Use consented Chat Completion Test for providers without model metadata." }) as Check),
        { label: "Last observed routing identity", status: !provider.identity || provider.identity === "not_tested" ? "NOT TESTED" :
          provider.identity === "attested" ? "PASS" : "WARNING", value: provider.identity,
          action: "Endpoint response and fallback behavior are separate from a verified signed model identity." },
      ]} />)}
      <Checks title="Local speech" items={[
        check("Configured speech model", report.speech.model), check("FFmpeg", report.speech.ffmpeg, "Use the production image with native speech tools."),
        check("Whisper binary", report.speech.whisper, "Use the production image with native speech tools."),
        check("Whisper model", report.speech.whisperModel, "Install the verified local Whisper model in the persistent volume."),
        check("Piper runtime", report.speech.piper, "Use the production image with native speech tools."),
        check("Piper voice", report.speech.piperVoice, "Install the verified English voice in the persistent volume."),
        { label: "Transcription", status: report.speech.stt ? "PASS" : "WARNING", action: "Enable transcription after the binary and model checks pass." },
        { label: "Read-aloud", status: report.speech.tts ? "PASS" : "WARNING", action: "Enable read-aloud after the runtime and voice checks pass." },
      ]} />
      <Checks title="Storage" items={[
        check("Document storage readiness", report.workspace.documentStorageReady, "Check files and artifacts ownership and filesystem access."),
        check("Model storage readiness", report.workspace.modelStorageReady, "Check ownership and permissions on the models directory."),
        { label: "Available disk and capacity", status: report.storage.status === "available" ? "PASS" : "FAIL", value: report.storage,
          action: "Check the named volume, filesystem free space, and ownership." },
        ...Object.entries(report.directories).map(([name, directory]) => ({
          label: name, status: directory.readable && directory.writable ? "PASS" : "FAIL", value: directory,
          action: "Restore app UID/GID ownership and private directory permissions.",
        }) as Check),
      ]} />
    </>}
  </div>;
}
