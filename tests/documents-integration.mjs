
const { readdir, utimes } = await import("node:fs/promises");
const leafNames = async (directory) => (await readdir(directory, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile()).map((entry) => entry.name);
const orphan = "00000000-0000-4000-8000-000000000000.pending";

const documentsCookie = sessionFrom(await submit("/login", { password: await readFile(passwordFile, "utf8") }), "/assistant");
const documentsHeaders = { Cookie: documentsCookie, Origin: root };
const api = (suffix = "", options = {}) => visit("/api/documents" + suffix, {
  ...options, headers: { ...documentsHeaders, ...options.headers },
});

async function migrate() {
  const response = await submit("/settings", { dedicated: "on" }, { cookie: documentsCookie, operation: "migrate" });
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes("Workspace migrations applied."), "Migration must succeed");
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
  await migrate();
  await migrate();
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

  async function switchTo(database) {
    const url = "postgresql://slm_app:" + process.env.SLM_TEST_DB_PASSWORD + "@db-fixture:5432/" + database + "?sslmode=disable";
    const response = await submit("/settings", { url, confirm: "on" }, { cookie: documentsCookie, operation: "database" });
    assert.ok((await response.text()).includes("Settings saved."));
  }
  await switchTo("fixture");
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
