import Link from "next/link";
import { WorkspaceDiagnostics } from "@/components/workspace-diagnostics";
import { SettingsForm } from "@/components/settings-form";
import { currentAdmin } from "@/lib/auth";
import { requireAdmin } from "@/lib/access";
import { schemaHash, schemaVersion } from "@/lib/tool-registry.mjs";
import { speechCapabilities } from "@/lib/speech-native.mjs";
import { defaultSpeech, defaultPreferences, roles, settingsFrom } from "@/lib/settings";

export const metadata = { title: "Settings" };
const inputClass = "min-h-10 w-full rounded-md border border-[var(--line)] bg-[var(--page)] px-3 py-2";
const names = { distil: "Distil", comparison: "OpenAI or custom comparison", writer: "Dedicated writer" };

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="grid max-w-3xl gap-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-6">
    <h2 className="text-xl font-semibold">{title}</h2>
    {children}
  </section>;
}

const tabs = [
  { id: "database", label: "Database", requirement: "Required" },
  { id: "providers", label: "Model providers", requirement: "Optional" },
  { id: "speech", label: "Local speech", requirement: "Optional" },
  { id: "preferences", label: "Preferences", requirement: "Optional" },
  { id: "diagnostics", label: "Diagnostics", requirement: "" },
  { id: "account", label: "Account", requirement: "" },
] as const;

function ChatConsent() {
  return <label className="flex items-start gap-2 text-sm">
    <input name="chatConsent" type="checkbox" className="mt-1" />
    <span>Allow one chat completion test. It sends “Reply with OK.” to the provider and may incur a charge.</span>
  </label>;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireAdmin();
  const state = await currentAdmin();
  if (!state) return null;
  const settings = settingsFrom(state);
  const revision: number = state.revision;
  const prefs = settings.preferences ?? defaultPreferences;
  const speech = settings.speechSettings ?? defaultSpeech;
  const { tab } = await searchParams;
  const active = tabs.find(({ id }) => id === tab)?.id ?? "database";
  const speechStatus = active === "speech" ? await speechCapabilities(speech) : null;

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Settings</h1>
      <Link className="underline" href="/api/diagnostics" prefetch={false}>View authenticated diagnostics (JSON)</Link>
      <p className="text-[var(--muted)]">{!settings.database ? "Set up PostgreSQL to continue." :
        settings.providerChoice === "skipped" ? "Configuration saved in manual mode. Check Diagnostics for live workspace readiness." :
        settings.providerChoice ? "Database and provider configuration saved. Check Diagnostics for live workspace readiness." : "Set up Distil or continue in manual mode."}</p>

      <nav aria-label="Settings sections" className="flex flex-wrap gap-2 border-b border-[var(--line)] pb-3">
        {tabs.map(({ id, label, requirement }) => (
          <Link key={id} href={`/settings?tab=${id}`} aria-current={active === id ? "page" : undefined}
            className="grid min-h-11 rounded-md border border-[var(--line)] px-3 py-2 text-sm font-medium hover:underline aria-[current=page]:bg-[var(--panel)] aria-[current=page]:underline">
            {label}
            {requirement && <span className="text-xs font-normal text-[var(--muted)]">{requirement}</span>}
          </Link>
        ))}
      </nav>

      {active === "diagnostics" && <WorkspaceDiagnostics revision={revision} configured={Boolean(settings.database)} />}

      {active === "database" && <Panel title="PostgreSQL">
        <p className="text-sm font-medium">Required for the document and business workspace.</p>
        <p className="text-sm text-[var(--muted)]">Use a PostgreSQL connection URL with TLS certificate verification. An isolated internal network may explicitly use <code>sslmode=disable</code>.</p>
        <SettingsForm operation="database" revision={revision} submit="Test and save database">
          <label className="grid gap-1">Database URL
            <input className={inputClass} name="url" type="password" autoComplete="off" maxLength={4096}
              placeholder={settings.database ? "Configured · leave blank to keep" : "postgresql://…"} />
          </label>
          {settings.database && <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="confirm" className="mt-1" />
            <span>Confirm replacement. Existing data stays in the original database. No data is copied or migrated.</span>
          </label>}
        </SettingsForm>
        {settings.database && <SettingsForm operation="migrate" revision={revision} submit="Run workspace migrations">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="dedicated" required className="mt-1" />
            <span>I confirm this is a dedicated database with a restricted application login.</span>
          </label>
        </SettingsForm>}
      </Panel>}

      {active === "providers" && !settings.database && <Panel title="Model providers">
        <p>Connect PostgreSQL first. Model providers are optional and can be configured later.</p>
        <Link className="underline" href="/settings?tab=database">Open database settings</Link>
      </Panel>}
      {active === "providers" && settings.database && (
        <Panel title="Model provider setup">
          <p className="text-sm text-[var(--muted)]">Optional. Manual mode supports document and business workflows. Provider verification uses model metadata or a fixed test message and sends no document content.</p>
          {settings.providerChoice !== "skipped" &&
            <SettingsForm operation="skip" revision={revision} submit="Continue without a provider" />}
          {settings.providerChoice === "skipped" && settings.distil &&
            <SettingsForm operation="resume-provider" revision={revision} submit="Test and re-enable Distil"><ChatConsent /></SettingsForm>}
        </Panel>
      )}

      {active === "providers" && settings.database && roles.map((role) => {
        const current = settings[role];
        return <Panel key={role} title={names[role]}>
          <details open={role === "distil"} className="grid">
            <summary className="mb-3 cursor-pointer text-sm font-medium">{current ? "Configured · Edit connection" : "Configure connection"}</summary>
          <SettingsForm operation={role} revision={revision} submit="Test and save provider">
            <label className="grid gap-1">HTTPS base URL
              <input className={inputClass} name="endpoint" type="password" autoComplete="off" maxLength={2048}
                placeholder={current ? "Configured · leave blank to keep" : "https://api.openai.com/v1"} />
            </label>
            <label className="grid gap-1">API key
              <input className={inputClass} name="key" type="password" autoComplete="off" maxLength={4096}
                placeholder={current?.key ? "Configured · leave blank to keep" : "Optional for unauthenticated servers"} />
            </label>
            <label className="grid gap-1">Model ID
              <input className={inputClass} name="model" defaultValue={current?.model} maxLength={160} />
            </label>
            <label className="flex gap-2"><input name="custom" type="checkbox" defaultChecked={current?.custom} />Allow a custom HTTPS endpoint</label>
            <label className="flex gap-2"><input name="privateNetwork" type="checkbox" defaultChecked={current?.privateNetwork} />Allow a private network address for this endpoint</label>
            <label className="grid gap-1">Validation mode
              <select className={inputClass} name="validationMode" defaultValue={current?.validationMode ?? "automatic"}>
                <option value="automatic">Automatic</option>
                <option value="discovery">Model Discovery</option>
                <option value="chat">Chat Completion Test</option>
              </select>
            </label>
            <p className="text-sm text-[var(--muted)]">Automatic tries model discovery first. If the lookup is unavailable, it can test your entered model ID with your permission. Use Chat Completion Test to test the model directly.</p>
            <ChatConsent />
            {current?.key && <label className="flex gap-2"><input name="clearKey" type="checkbox" />Clear the stored key</label>}
          </SettingsForm>
          {current && <SettingsForm operation={role} revision={revision} submit="Remove provider">
            <input type="hidden" name="remove" value="on" />
          </SettingsForm>}
          </details>
        </Panel>;
      })}

      {active === "providers" && settings.distil && <Panel title="Distil routing profile">
        <p className="text-sm text-[var(--muted)]">Import JSON metadata for the exact configured model. An operator-pinned Ed25519 key allows compatible endpoints to attest each routing response.</p>
        <p className="text-sm wrap-anywhere">Schema {schemaVersion} · {schemaHash}</p>
        {settings.routingProfile && <p className="text-sm">Metadata imported for {settings.routingProfile.modelId}.</p>}
        <SettingsForm operation="profile" revision={revision} submit="Import routing metadata">
          <label className="grid gap-1">Model metadata JSON
            <textarea name="metadata" className={inputClass} rows={5} maxLength={16000} required autoComplete="off" spellCheck={false} />
          </label>
        </SettingsForm>
      </Panel>}

      {speechStatus && <Panel title="Local speech">
        <p>FFmpeg {speechStatus.ffmpeg ? "available" : "missing"} · Whisper CLI {speechStatus.whisper ? "available" : "missing"} · Piper {speechStatus.piper ? "available" : "missing"}</p>
        <p>Whisper model {speechStatus.whisperModel ? "installed" : "missing"} · English Piper voice {speechStatus.piperVoice ? "installed" : "missing"}</p>
        <SettingsForm operation="speech" revision={revision} submit="Save speech settings">
          <label className="flex gap-2"><input type="checkbox" name="enabled" defaultChecked={speech.enabled} />Enable local speech</label>
          <label className="grid gap-1">Whisper model
            <select className={inputClass} name="model" defaultValue={speech.model}>
              <option value="base">Base multilingual</option><option value="off">Transcription off</option>
            </select>
          </label>
          <label className="grid gap-1">Transcription language
            <select className={inputClass} name="language" defaultValue={speech.language}>
              {["auto", "en", "de", "fr", "es", "it", "zh", "ja", "my"].map((language) => <option key={language}>{language}</option>)}
            </select>
          </label>
          <label className="grid gap-1">Maximum recording seconds
            <input className={inputClass} name="maxSeconds" type="number" required min={5} max={60} defaultValue={speech.maxSeconds} />
          </label>
          <label className="flex gap-2"><input type="checkbox" name="readAloud" defaultChecked={speech.readAloud} />Enable English read-aloud with Lessac Low</label>
        </SettingsForm>
      </Panel>}

      {active === "account" && <Panel title="Administrator password">
        <SettingsForm operation="password" revision={revision} submit="Change password">
          <label className="grid gap-1">Current password
            <input className={inputClass} name="current" required type="password" autoComplete="current-password" maxLength={128} />
          </label>
          <label className="grid gap-1">New password
            <input className={inputClass} name="replacement" required type="password" autoComplete="new-password" minLength={12} maxLength={128} />
          </label>
        </SettingsForm>
      </Panel>}

      {active === "preferences" && <Panel title="Preferences">
        <p className="text-sm text-[var(--muted)]">Document and speech workflows will apply these preferences when those features are available.</p>
        <SettingsForm operation="preferences" revision={revision} submit="Save preferences">
          <label className="grid gap-1">Timezone
            <input className={inputClass} name="timezone" required defaultValue={prefs.timezone} maxLength={80} />
          </label>
          <label className="grid gap-1">Speech model
            <select className={inputClass} name="speech" defaultValue={prefs.speech}>
              <option value="off">Off</option><option value="tiny">Tiny</option>
              <option value="base">Base</option><option value="small">Small</option>
            </select>
          </label>
          <label className="grid gap-1">Maximum upload size (MiB)
            <input className={inputClass} name="uploadMiB" type="number" required min={1} max={64} defaultValue={Math.min(64, prefs.uploadMiB)} />
          </label>
          <label className="grid gap-1">Requests per minute
            <input className={inputClass} name="requestsPerMinute" type="number" required min={1} max={120} defaultValue={prefs.requestsPerMinute} />
          </label>
          <label className="flex gap-2"><input name="shareDocuments" type="checkbox" defaultChecked={prefs.shareDocuments} />Allow synthetic document content to be shared with configured providers</label>
        </SettingsForm>
      </Panel>}
    </>
  );
}
