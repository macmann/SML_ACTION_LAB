
const { readdir, utimes } = await import("node:fs/promises");
const leafNames = async (directory) => (await readdir(directory, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile()).map((entry) => entry.name);
const orphan = "00000000-0000-4000-8000-000000000000.pending";

const documentsCookie = sessionFrom(await submit("/login", { password: await readFile(passwordFile, "utf8") }), "/assistant");
const documentsHeaders = { Cookie: documentsCookie, Origin: root };
const api = (suffix = "", options = {}) => visit("/api/documents" + suffix, {
  ...options, headers: { ...documentsHeaders, ...options.headers },
});

const readinessReport = async () => {
  const response = await visit("/api/diagnostics", { headers: documentsHeaders });
  assert.equal(response.status, 200);
  const raw = await response.text();
  if (process.env.SLM_TEST_DB_PASSWORD) assert.ok(!raw.includes(process.env.SLM_TEST_DB_PASSWORD));
  assert.ok(!raw.includes("postgresql://") && !raw.includes("model-fixture"));
  return JSON.parse(raw);
};
async function switchTo(database, role = "slm_app") {
  const url = "postgresql://" + role + ":" + process.env.SLM_TEST_DB_PASSWORD + "@db-fixture:5432/" + database + "?sslmode=disable";
  const response = await submit("/settings", { url, confirm: "on" }, { cookie: documentsCookie, operation: "database" });
  assert.match(await response.text(), /Settings saved/);
}
async function migrate(expected = /Workspace migrations applied/) {
  const response = await submit("/settings", { dedicated: "on" }, { cookie: documentsCookie, operation: "migrate" });
  assert.equal(response.status, 200);
  assert.match(await response.text(), expected);
}

async function upload(filename, body, mime, metadata = {}) {
  return api("", { method: "POST", body, headers: { "Content-Type": mime,
    "Slm-Upload": encodeURIComponent(JSON.stringify({ filename, ...metadata })) } });
}
async function lookup(params = "") {
  const response = await api(params ? "?" + params : "");
  assert.equal(response.status, 200);
  return response.json();
}

assert.equal((await visit("/api/documents")).status, 401);

if (process.argv.includes("documents-persisted")) {
  const report = await readinessReport();
  assert.equal(report.database, "ready");
  assert.equal(report.migrations.actualVersion, 5);
  const { results, attachments } = await lookup("q=QZ-381");
  assert.equal(results.length, 4);
  assert.ok(results.some((doc) => doc.filename === "Fixture.pdf" && doc.reference === "Page 1"));
  assert.equal(attachments.length, 1);
  assert.ok(!(await leafNames("/app/data/files")).includes(orphan), "Restart must reconcile known stale orphan patterns");
  const deletion = await api("/" + attachments[0].id, { method: "DELETE" });
  assert.equal(deletion.status, 204);
  assert.equal((await lookup("q=QZ-381")).total, 3);
  assert.equal((await api("/" + attachments[0].id + "/download")).status, 404);
  assert.ok(!(await leafNames("/app/data/files")).includes(attachments[0].id));
  assert.ok(!(await leafNames("/app/data/artifacts")).includes(attachments[0].id));
  console.log("Document index rebuilt after restart; deletion removed the document and attachment.");
} else {
  assert.equal((await api()).status, 503);
  const refused = await submit("/settings", {}, { cookie: documentsCookie, operation: "migrate" });
  assert.match(await refused.text(), /Confirm that this database is dedicated/);
  const resume = await submit("/settings", {}, { cookie: documentsCookie, operation: "resume-provider" });
  assert.match(await resume.text(), /Settings saved/);
  const before = await readinessReport();
  assert.equal(before.providers.distil.configured, true);
  assert.equal(before.providers.distil.enabled, true);
  assert.equal(before.connectivity.selectOne, true);
  assert.equal(before.connectivity.target.database, "replacement");
  assert.equal(before.database, "migrations_required");
  assert.equal(before.migrations.registryAvailable, true);
  assert.deepEqual(before.migrations.pending, [1, 2, 3, 4, 5]);
  assert.equal(before.workspace.assistant.distil.ready, false);
  assert.equal((await visit("/api/agent", { headers: documentsHeaders })).status, 503);
  await switchTo("replacement", "slm_fixture");
  await migrate(/Inspect database permissions failed.*rolsuper is true/);
  let rejected = await readinessReport();
  assert.equal(rejected.migrations.lastAttempt.diagnostic.category, "permission_policy_rejection");
  assert.equal(rejected.connectivity.permissions.find(({ name }) => name === "rolsuper").passed, false);
  await switchTo("replacement", "slm_elevated");
  await migrate(/Inspect database permissions failed.*rolcreaterole is true/);
  assert.equal((await readinessReport()).migrations.lastAttempt.type, "failed");
  await switchTo("replacement", "slm_limited");
  await migrate(/Prepare workspace schema failed.*CREATE on the dedicated database/);
  assert.equal((await readinessReport()).migrations.lastAttempt.type, "failed");
  await switchTo("OFFGRID", "offgrid_app");
  const owner = await readinessReport();
  assert.equal(owner.connectivity.target.database, "OFFGRID");
  assert.equal(owner.connectivity.target.username, "offgrid_app");
  assert.equal(owner.connectivity.target.publicOwner, "pg_database_owner");
  assert.equal(owner.connectivity.target.publicEffectiveOwner, true);
  assert.equal(owner.connectivity.target.databaseOwner, true);
  assert.equal(owner.connectivity.target.publicCreate, true);
  const failedPredicates = owner.connectivity.permissions.filter(({ passed }) => !passed);
  assert.deepEqual(failedPredicates.map(({ name }) => name), ["pg_read_all_data membership"]);
  await migrate(/Inspect database permissions failed.*pg_read_all_data membership is true/);
  rejected = await readinessReport();
  assert.equal(rejected.migrations.lastAttempt.diagnostic.queryId, "database.permissions");
  assert.equal(rejected.migrations.lastAttempt.diagnostic.category, "permission_policy_rejection");

  const { Client } = (await import("pg")).default;
  const fixtureConnection = { host: "db-fixture", port: 5432, database: "OFFGRID", password: process.env.SLM_TEST_DB_PASSWORD };
  const admin = new Client({ ...fixtureConnection, user: "slm_fixture" });
  await admin.connect();
  try {
    await admin.query("REVOKE pg_read_all_data FROM offgrid_app");
    await admin.query("GRANT pg_write_all_data TO offgrid_app");
    await migrate(/Inspect database permissions failed.*pg_write_all_data membership is true/);
    await admin.query("REVOKE pg_write_all_data FROM offgrid_app");
  } finally { await admin.end(); }

  const ownerClient = new Client({ ...fixtureConnection, user: "offgrid_app" });
  await ownerClient.connect();
  try {
    await ownerClient.query("CREATE SCHEMA slm_workspace");
    await ownerClient.query("REVOKE CREATE ON SCHEMA slm_workspace FROM offgrid_app");
    await migrate(/Prepare workspace schema failed.*CREATE on slm_workspace is false/);
    const ddlDenied = await readinessReport();
    assert.equal(ddlDenied.connectivity.permissions.find(({ name }) => name === "CREATE on slm_workspace").passed, false);
    await ownerClient.query("GRANT CREATE ON SCHEMA slm_workspace TO offgrid_app");
    await ownerClient.query("CREATE TABLE slm_workspace.schema_migrations (fictional_fixture integer)");
    await migrate(/Read migration ledger failed.*42703/);
    const failedSql = await readinessReport();
    for (const detail of [failedSql.connectivity.failure, failedSql.migrations.lastAttempt.diagnostic]) {
      assert.equal(detail.category, "sql_execution_failure");
      assert.equal(detail.queryId, "workspace.ledger");
      assert.equal(detail.sqlstate, "42703");
      assert.equal(typeof detail.durationMs, "number");
      assert.ok(!detail.message.includes("fictional_fixture"));
    }
    await ownerClient.query("ALTER TABLE slm_workspace.schema_migrations RENAME TO fixture_incomplete_ledger");
  } finally { await ownerClient.end(); }
  await migrate(/Workspace migrations applied.*Applied 5, pending 0, verified/);
  const initialized = await readinessReport();
  assert.ok(initialized.connectivity.permissions.every(({ passed }) => passed));
  assert.equal(initialized.workspace.ready, true);
  assert.equal(initialized.workspace.assistant.distil.ready, true);
  assert.equal(initialized.migrations.actualVersion, 5);
  assert.equal((await visit("/api/agent", { headers: documentsHeaders })).status, 200);
  console.log("Verified a dedicated OFFGRID owner, pg_database_owner semantics, both broad membership rejections, and sanitized SQLSTATE reporting.");
  await switchTo("replacement");
  await migrate(/Workspace migrations applied.*Applied 5, pending 0, verified/);
  await migrate(/No pending migrations.*Applied 0, pending 0/);
  assert.equal((await readinessReport()).workspace.assistant.distil.ready, true);
  const skip = await submit("/settings", {}, { cookie: documentsCookie, operation: "skip" });
  assert.match(await skip.text(), /Settings saved/);
  const after = await readinessReport();
  assert.equal(after.workspace.ready, true);
  assert.deepEqual(after.migrations.missingTables, []);
  assert.equal(after.migrations.lastAttempt.type, "no_pending");
  assert.equal((await visit("/api/agent", { headers: documentsHeaders })).status, 200);
  assert.equal((await lookup()).total, 0);
  assert.equal((await upload("../fixture.txt", "fixture", "text/plain")).status, 400);
  assert.equal((await upload("broken.pdf", "not a PDF", "application/pdf")).status, 422);
  assert.equal((await api("", { method: "POST", headers: { Origin: "https://unrelated.invalid" } })).status, 403);
  assert.equal((await lookup()).total, 0);
  assert.deepEqual(await leafNames("/app/data/files"), []);
  assert.deepEqual(await leafNames("/app/data/artifacts"), []);
  const content = "Fixture order QZ-381\n\nFixture duplicate QZ-381";
  const created = await upload("QZ-381.txt", content, "text/plain", { title: "Fixture order", tags: ["account"], documentDate: "2024-02-03" });
  assert.equal(created.status, 201, await created.clone().text());
  const { id } = await created.json();
  assert.ok((await leafNames("/app/data/files")).includes(id));
  assert.ok((await leafNames("/app/data/artifacts")).includes(id));
  const filenames = [
    ["Fixture.pdf", pdfFixture(), "application/pdf"],
    ["Scanned.pdf", pdfFixture(false), "application/pdf"],
    ["Fixture.docx", await docxFixture(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["Fixture.xlsx", await xlsxFixture(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ];
  for (const [filename, bytes, mime] of filenames) {
    const response = await upload(filename, bytes, mime, { tags: ["fixture"] });
    assert.equal(response.status, 201, filename + " " + await response.clone().text());
    if (filename === "Scanned.pdf") assert.equal((await response.json()).extraction, "no_text");
  }
  assert.equal((await lookup("q=QZ-381")).total, 4);
  assert.equal((await lookup("q=QZ-38")).total, 0);
  assert.equal((await lookup("q=QZ-381&dateField=document&from=2024-02-01")).results[0].id, id);
  assert.equal((await lookup("q=QZ-381&dateField=uploaded&to=2024-02-01")).total, 0);
  const preview = await (await api("/" + id)).json();
  assert.equal(preview.sections.length, 2);
  assert.equal((await visit("/api/documents/" + id + "/download")).status, 401);
  const attachment = await api("/" + id + "/download");
  assert.equal(attachment.status, 200);
  assert.match(attachment.headers.get("content-disposition"), /^attachment/);
  assert.equal(await attachment.text(), content);
  assert.equal((await api("/" + id, { method: "PATCH", headers: { "Slm-Attachment": "true" } })).status, 204);
  assert.equal((await lookup()).attachments[0].id, id);

  await switchTo("fixture");
  const switched = await readinessReport();
  assert.equal(switched.connectivity.target.database, "fixture");
  assert.equal(switched.migrations.actualVersion, 0);
  assert.equal((await api()).status, 503);
  await migrate();
  assert.equal((await lookup("q=QZ-381")).total, 0);
  await switchTo("replacement");
  assert.equal((await lookup("q=QZ-381")).total, 4);
  assert.equal((await lookup()).attachments[0].id, id);
  const namespaces = await readdir("/app/data/files");
  const namespace = (await Promise.all(namespaces.map(async (name) =>
    (await readdir("/app/data/files/" + name)).includes(id) ? name : null))).find(Boolean);
  assert.ok(namespace);
  const orphanPath = "/app/data/files/" + namespace + "/" + orphan;
  await writeFile(orphanPath, "fictional interrupted upload", { mode: 0o600 });
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(orphanPath, past, past);
  console.log("Migrations, all Office/PDF uploads, search, private download, attachments and database switching passed.");
}
