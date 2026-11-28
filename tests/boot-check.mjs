import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID as testUuid } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { store } from "./lib/bootstrap.mjs";

const root = "http://127.0.0.1:3000";
const visit = (path, options = {}) => fetch(root + path, { redirect: "manual", ...options });

async function readiness(stage, database = "not_configured", provider = "not_configured") {
  const response = await visit("/api/health/ready");
  assert.equal(response.status, stage === "ready" ? 200 : 503);
  assert.deepEqual(await response.json(), {
    status: stage === "ready" ? "ready" : "not_ready",
    setup: stage === "unclaimed" ? "unclaimed" : "claimed",
    database, provider, stage,
  });
}

const htmlValue = (value) => value.replaceAll(/&(?:quot|amp|lt|gt|#x27);/g, (entity) => ({
  "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">", "&#x27;": "'",
})[entity]);

async function submit(path, fields, { cookie, operation, origin = root } = {}) {
  if (path === "/settings" && operation) {
    const tab = ["database", "migrate"].includes(operation) ? "database" :
      operation === "password" ? "account" : operation === "preferences" ? "preferences" :
      operation === "speech" ? "speech" : "providers";
    path += "?tab=" + tab;
  }
  const response = await visit(path, { headers: cookie ? { Cookie: cookie } : {} });
  assert.equal(response.status, 200);
  const page = await response.text();
  const forms = [...page.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(([form]) => form);
  const selected = forms.find((form) => operation
    ? [...form.matchAll(/<input[^>]+>/g)].some(([input]) =>
      input.includes('name="operation"') && input.includes('value="' + operation + '"'))
    : /\$ACTION_REF_/.test(form));
  assert.ok(selected, "Expected a server action form");
  const form = new FormData();
  for (const [html] of selected.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = html.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    form.append(name, htmlValue(html.match(/value="([^"]*)"/)?.[1] ?? ""));
  }
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return visit(path, { method: "POST", body: form, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) } });
}

function sessionFrom(response, destination) {
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), destination);
  const header = response.headers.get("set-cookie") ?? "";
  for (const flag of [/^__Host-slm_session=/, /HttpOnly/i, /Secure/i, /SameSite=strict/i]) {
    assert.ok(flag.test(header), "Session cookie must have the expected name and security flags");
  }
  return header.split(";")[0];
}

assert.notEqual(process.getuid(), 0);
assert.equal((await stat("/app/data")).mode & 0o777, 0o700);
const liveness = await visit("/api/health/live");
assert.equal(liveness.status, 200);
assert.deepEqual(await liveness.json(), { status: "alive" });
const passwordFile = "/app/data/tmp/smoke-password";

if (process.argv.includes("restored")) {
  const cookie = sessionFrom(await submit("/login", { password: await readFile(passwordFile, "utf8") }), "/assistant");
  const headers = { Cookie: cookie };
  const list = await visit("/api/documents?q=QZ-381", { headers });
  assert.equal(list.status, 200);
  const document = (await list.json()).results.find((item) => item.filename === "Assistant fixture.txt");
  assert.ok(document);
  const download = await visit("/api/documents/" + document.id + "/download", { headers });
  assert.equal(download.status, 200);
  assert.match(await download.text(), /Invoice ID: QZ-381/);
  console.log("Restored database and fresh volume recovered admin sign-in, encrypted settings, search and original download.");
} else if (process.argv.includes("provider-offline")) {
  const cookie = sessionFrom(await submit("/login", { password: await readFile(passwordFile, "utf8") }), "/assistant");
  const headers = { Cookie: cookie, Origin: root, "Content-Type": "application/json" };
  const result = await visit("/api/agent", { method: "POST", headers,
    body: JSON.stringify({ id: testUuid(), request: "Find fictional fixture documents", mode: "model_only", active: [] }) });
  assert.equal(result.status, 502);
  assert.match((await result.json()).error, /provider failed/i);
  assert.equal((await visit("/api/documents", { headers })).status, 200);
  const diagnostics = await (await visit("/api/diagnostics", { headers })).json();
  assert.equal(diagnostics.workspace.ready, true);
  assert.equal(diagnostics.workspace.assistant.distil.ready, false);
  assert.ok(["last_request_failed", "blocked"].includes(diagnostics.providers.distil.availability));
  assert.equal(diagnostics.providers.distil.lastInferenceError.type, "failed");
  console.log("An unreachable provider failed without fallback while manual document operations remained available.");
} else if (process.argv.includes("database-offline")) {
  const cookie = sessionFrom(await submit("/login", { password: await readFile(passwordFile, "utf8") }), "/assistant");
  assert.equal((await visit("/settings", { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await visit("/api/documents", { headers: { Cookie: cookie } })).status, 503);
  const report = await (await visit("/api/diagnostics", { headers: { Cookie: cookie } })).json();
  assert.equal(report.database, "unavailable");
  assert.equal(report.connectivity.configured, true);
  assert.equal(report.connectivity.connected, false);
  assert.ok(report.workspace.blockers.length > 0);
  assert.equal(report.migrations.applied, null);
  console.log("Administrator sign-in and Settings remained available during a PostgreSQL outage.");
} else if (process.argv.includes("persisted")) {
  await readiness("ready", "configured", "skipped");
  assert.equal((await visit("/assistant")).headers.get("location"), "/login");
  const password = await readFile(passwordFile, "utf8");
  const cookie = sessionFrom(await submit("/login", { password }), "/assistant");
  const { settings } = await store.load();
  assert.equal(settings.databaseGeneration, 7);
  assert.ok((await store.decrypt("database", settings.database)).includes("/replacement"));
  assert.equal(settings.preferences.timezone, "Europe/Berlin");
  const recovered = randomBytes(24).toString("base64url");
  execFileSync(process.execPath, ["scripts/operator.mjs", "reset-password"], { input: recovered + "\n" });
  assert.equal((await visit("/settings", { headers: { Cookie: cookie } })).headers.get("location"), "/login");
  assert.notEqual((await submit("/login", { password })).status, 303);
  assert.ok(sessionFrom(await submit("/login", { password: recovered }), "/assistant"));
  await writeFile(passwordFile, recovered, { mode: 0o600 });
  console.log("Admin and encrypted settings survived restart, and console recovery revoked the session.");
} else if (!process.argv.includes("agent") && !process.argv.some((argument) => argument.startsWith("documents"))) {
  await readiness("unclaimed");
  for (const path of ["/", "/assistant", "/documents", "/tasks", "/invoices", "/model-arena", "/logs", "/settings"]) {
    const response = await visit(path);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/setup");
  }
  const password = randomBytes(24).toString("base64url");
  const code = await store.rotateToken();
  const setup = await visit("/setup");
  assert.equal(setup.status, 200);
  const html = await setup.text();
  assert.match(html, /Claim this instance/);
  assert.ok(!html.includes(code), "Pairing token must never appear in HTML");
  const crossOrigin = await submit("/setup", { code, password }, { origin: "https://unrelated.invalid" });
  assert.notEqual(crossOrigin.status, 303);
  await readiness("unclaimed");
  await submit("/setup", { code: "a".repeat(43), password });
  await readiness("unclaimed");

  const cookie = sessionFrom(await submit("/setup", { code, password }), "/settings");
  await readiness("claimed");
  assert.equal((await visit("/", { headers: { Cookie: cookie } })).headers.get("location"), "/settings");
  assert.equal((await visit("/setup")).headers.get("location"), "/login");
  assert.equal((await visit("/assistant", { headers: { Cookie: cookie + "invalid" } })).headers.get("location"), "/login");

  const dbPassword = process.env.SLM_TEST_DB_PASSWORD;
  const providerKey = process.env.SLM_TEST_PROVIDER_KEY;
  assert.ok(providerKey, "The model server requires a generated fixture key");
  assert.ok(dbPassword, "The test database requires a generated fixture password");
  const dbUrl = "postgresql://slm_app:" + dbPassword + "@db-fixture:5432/";
  const suffix = "?sslmode=disable";
  const save = async (operation, fields = {}) => {
    const result = await submit("/settings", fields, { cookie, operation });
    assert.equal(result.status, 200);
    const body = await result.text();
    assert.ok(!body.includes(dbPassword) && !body.includes(providerKey), "Credentials must not appear in HTML");
    return body;
  };

  await save("database", { url: dbUrl + "fixture" + suffix });
  await readiness("database_configured", "configured");
  assert.equal((await store.load()).settings.databaseGeneration, 1);
  await save("database", { url: dbUrl + "replacement" + suffix });
  assert.equal((await store.load()).settings.databaseGeneration, 1, "Replacement must require confirmation");
  await save("database", { url: dbUrl + "missing" + suffix, confirm: "on" });
  assert.equal((await store.load()).settings.databaseGeneration, 1, "Failed probes must preserve active settings");
  await save("database", { url: dbUrl + "replacement" + suffix, confirm: "on" });
  assert.equal((await store.load()).settings.databaseGeneration, 2);
  await save("database");
  assert.equal((await store.load()).settings.databaseGeneration, 2, "Blank input must preserve the active database");
  await save("distil", { endpoint: "https://169.254.169.254/v1", model: "fixture", custom: "on", privateNetwork: "on" });
  assert.equal((await store.load()).settings.distil, undefined);
  const provider = { endpoint: "https://model-fixture:8443/v1", key: providerKey, model: "fixture", custom: "on" };
  await save("distil", provider);
  assert.equal((await store.load()).settings.distil, undefined, "Private provider requires explicit opt-in");
  const manual = { ...provider, privateNetwork: "on", model: "fixture-chat" };
  assert.match(await save("distil", manual), /discovery is unavailable \(HTTP 404\)/);
  assert.equal((await store.load()).settings.distil, undefined, "The chat probe requires consent");
  assert.match(await save("distil", { ...manual, validationMode: "discovery", chatConsent: "on" }),
    /Model discovery failed \(HTTP 404\)/);
  assert.match(await save("distil", { ...manual, key: "invalid-fixture-key", chatConsent: "on" }),
    /Model discovery failed \(HTTP 401\)/);
  assert.match(await save("distil", { ...manual, model: "invalid model", chatConsent: "on" }), /Model ID is invalid/);
  assert.match(await save("distil", { ...manual, model: "fixture-slow", chatConsent: "on" }), /Model discovery timed out/);
  assert.match(await save("distil", { ...manual, model: "missing-model", chatConsent: "on" }),
    /Chat completion test failed \(HTTP 404\)/);
  assert.match(await save("distil", { ...manual, validationMode: "chat", key: "invalid-fixture-key", chatConsent: "on" }),
    /Chat completion test failed \(HTTP 401\)/);
  assert.match(await save("distil", { ...manual, validationMode: "chat" }), /Allow the chat completion test/);
  assert.match(await save("distil", { ...manual, chatConsent: "on" }), /Settings saved/);
  const fallbackSaved = (await store.load()).settings.distil;
  assert.equal(fallbackSaved.model, "fixture-chat");
  assert.equal(fallbackSaved.validationMode, "automatic");
  assert.ok(await store.decrypt("distil", fallbackSaved.key) === providerKey);
  for (const status of [405, 501]) {
    assert.match(await save("distil", { ...manual, model: "fixture-chat-" + status, chatConsent: "on" }), /Settings saved/);
  }
  assert.match(await save("distil", { ...manual, validationMode: "chat", chatConsent: "on" }), /Settings saved/);
  assert.equal((await store.load()).settings.distil.validationMode, "chat");
  assert.match(await save("distil", { ...manual, model: "fixture-empty", chatConsent: "on" }),
    /Chat completion test returned an invalid or oversized response \(HTTP 200\)/);
  assert.equal((await store.load()).settings.distil.model, "fixture-chat");
  await save("distil", { ...provider, privateNetwork: "on", validationMode: "discovery" });
  assert.equal((await store.load()).settings.distil.model, "fixture");
  await readiness("ready", "configured", "configured");
  const configured = (await store.load()).settings.distil;
  assert.ok(await store.decrypt("distil", configured.key) === providerKey);
  await save("distil", { ...provider, endpoint: "", key: "", privateNetwork: "on" });
  assert.ok(await store.decrypt("distil", (await store.load()).settings.distil.key) === providerKey);
  await save("distil", { ...provider, endpoint: "https://model-fixture:8443/redirect", privateNetwork: "on" });
  assert.ok(await store.decrypt("distil.endpoint", (await store.load()).settings.distil.endpoint) === provider.endpoint);
  await save("skip");
  await readiness("ready", "configured", "skipped");
  await save("preferences", { timezone: "Europe/Berlin", speech: "base", uploadMiB: "32", requestsPerMinute: "12" });
  assert.equal((await store.load()).settings.preferences.timezone, "Europe/Berlin");

  const replacementCookie = sessionFrom(await submit("/login", { password }), "/assistant");
  assert.equal((await visit("/settings", { headers: { Cookie: cookie } })).headers.get("location"), "/login");
  assert.equal((await visit("/settings", { headers: { Cookie: replacementCookie } })).status, 200);
  await writeFile(passwordFile, password, { mode: 0o600 });
  console.log("Clean boot, claim, origin check, session rotation, database switching, provider discovery and chat validation, consent, rejection details, encryption, redirect rejection and manual mode verified.");
}
