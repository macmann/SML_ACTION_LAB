import { SettingsForm } from "@/components/settings-form";
import { currentAdmin } from "@/lib/auth";
import { requireAdmin } from "@/lib/access";
import { defaultPreferences, roles, settingsFrom } from "@/lib/settings";

export const metadata = { title: "Settings" };
const inputClass = "min-h-10 w-full rounded-md border border-[var(--line)] bg-[var(--page)] px-3 py-2";
const names = { distil: "Distil", comparison: "OpenAI or custom comparison", writer: "Dedicated writer" };

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="grid max-w-3xl gap-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 sm:p-6">
    <h2 className="text-xl font-semibold">{title}</h2>
    {children}
  </section>;
}

export default async function SettingsPage() {
  await requireAdmin();
  const state = await currentAdmin();
  if (!state) return null;
  const settings = settingsFrom(state);
  const revision: number = state.revision;
  const prefs = settings.preferences ?? defaultPreferences;

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Settings</h1>
      <p className="text-[var(--muted)]">{!settings.database ? "Set up PostgreSQL to continue." :
        settings.providerChoice === "skipped" ? "Setup complete in manual mode." :
        settings.providerChoice ? "Setup complete with a configured provider." : "Set up Distil or continue in manual mode."}</p>

      <Panel title="PostgreSQL">
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
      </Panel>

      {settings.database && (
        <Panel title="Model provider setup">
          <p className="text-sm text-[var(--muted)]">Provider tests fetch model metadata over HTTPS. They send no prompts or documents.</p>
          {settings.providerChoice !== "skipped" &&
            <SettingsForm operation="skip" revision={revision} submit="Continue without a provider" />}
          {settings.providerChoice === "skipped" && settings.distil &&
            <SettingsForm operation="resume-provider" revision={revision} submit="Test and re-enable Distil" />}
        </Panel>
      )}

      {settings.database && roles.map((role) => {
        const current = settings[role];
        return <Panel key={role} title={names[role]}>
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
            {current?.key && <label className="flex gap-2"><input name="clearKey" type="checkbox" />Clear the stored key</label>}
          </SettingsForm>
          {current && <SettingsForm operation={role} revision={revision} submit="Remove provider">
            <input type="hidden" name="remove" value="on" />
          </SettingsForm>}
        </Panel>;
      })}

      <Panel title="Administrator password">
        <SettingsForm operation="password" revision={revision} submit="Change password">
          <label className="grid gap-1">Current password
            <input className={inputClass} name="current" required type="password" autoComplete="current-password" maxLength={128} />
          </label>
          <label className="grid gap-1">New password
            <input className={inputClass} name="replacement" required type="password" autoComplete="new-password" minLength={12} maxLength={128} />
          </label>
        </SettingsForm>
      </Panel>

      <Panel title="Preferences">
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
            <input className={inputClass} name="uploadMiB" type="number" required min={1} max={256} defaultValue={prefs.uploadMiB} />
          </label>
          <label className="grid gap-1">Requests per minute
            <input className={inputClass} name="requestsPerMinute" type="number" required min={1} max={120} defaultValue={prefs.requestsPerMinute} />
          </label>
          <label className="flex gap-2"><input name="shareDocuments" type="checkbox" defaultChecked={prefs.shareDocuments} />Allow document content to be shared with configured providers</label>
        </SettingsForm>
      </Panel>
    </>
  );
}
