import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

const root = "http://127.0.0.1:3000";
const visit = (path, options = {}) => fetch(root + path, { redirect: "manual", ...options });
const readiness = async (setup) => {
  const response = await visit("/api/health/ready");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    status: "not_ready", setup, database: "not_configured", provider: "not_configured",
  });
};

async function submit(path, fields, cookie) {
  const response = await visit(path, { headers: cookie ? { Cookie: cookie } : {} });
  assert.equal(response.status, 200);
  const page = await response.text();
  const field = page.match(/name="(\$ACTION_REF_[^"]+)"/);
  assert.ok(field, "Expected a progressively enhanced server action form");
  const htmlInputs = page.matchAll(/<input[^>]*type="hidden"[^>]*>/g);
  const form = new FormData();
  for (const [html] of htmlInputs) {
    const name = html.match(/name="([^"]+)"/)?.[1];
    if (!name?.startsWith("$ACTION_")) continue;
    const value = html.match(/value="([^"]*)"/)?.[1] ?? "";
    form.append(name, value.replaceAll(/&(?:quot|amp|lt|gt|#x27);/g, (entity) => ({
      "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">", "&#x27;": "'",
    })[entity]));
  }
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return visit(path, { method: "POST", body: form, headers: { Origin: root, ...(cookie ? { Cookie: cookie } : {}) } });
}

function sessionFrom(response) {
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/assistant");
  const header = response.headers.get("set-cookie") ?? "";
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=strict/i);
  return header.split(";")[0];
}

assert.notEqual(process.getuid(), 0);
assert.equal((await stat("/app/data")).mode & 0o777, 0o700);
const liveness = await visit("/api/health/live");
assert.equal(liveness.status, 200);
assert.deepEqual(await liveness.json(), { status: "alive" });
const passwordFile = "/app/data/tmp/smoke-password";
if (process.argv.includes("persisted")) {
  await readiness("claimed");
  assert.equal((await visit("/assistant")).headers.get("location"), "/login");
  const password = await readFile(passwordFile, "utf8");
  assert.ok(sessionFrom(await submit("/login", { password })));
  console.log("Admin claim survived restart and the password still works.");
} else {
  await readiness("unclaimed");
  for (const path of ["/", "/assistant", "/documents", "/tasks", "/invoices", "/model-arena", "/logs", "/settings"]) {
    const response = await visit(path);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/setup");
  }
  const setup = await visit("/setup");
  assert.equal(setup.status, 200);
  assert.match(await setup.text(), /Claim this instance/);
  const { writeFile } = await import("node:fs/promises");
  const password = randomBytes(24).toString("base64url");
  const code = (await readFile("/app/data/config/pairing-code", "utf8")).trim();
  await submit("/setup", { code: "a".repeat(32), password });
  await readiness("unclaimed");
  const cookie = sessionFrom(await submit("/setup", { code, password }));
  assert.equal((await visit("/", { headers: { Cookie: cookie } })).headers.get("location"), "/assistant");
  await readiness("claimed");
  assert.equal((await visit("/setup")).headers.get("location"), "/login");
  assert.equal((await visit("/assistant", { headers: { Cookie: cookie + "invalid" } })).headers.get("location"), "/login");
  assert.equal((await visit("/settings", { headers: { Cookie: cookie } })).status, 200);
  await writeFile(passwordFile, password, { mode: 0o600 });
  console.log("Clean volume boot, liveness, readiness, guarded routes, claim and session verified.");
}
