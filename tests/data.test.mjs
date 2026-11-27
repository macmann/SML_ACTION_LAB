import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { configPath, createPrivateFile } from "../lib/data.mjs";
import { dataDirectories, initializeData } from "../scripts/data-layout.mjs";

async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "slm-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("initialization creates private paths and preserves independent keys", async (t) => {
  const root = await temporaryRoot(t);
  await initializeData(root);
  const master = await readFile(configPath("master.key", root), "utf8");
  const session = await readFile(configPath("session.key", root), "utf8");
  assert.ok(/^[a-f0-9]{64}$/.test(master) && /^[a-f0-9]{64}$/.test(session) && master !== session);
  await initializeData(root);
  assert.ok(await readFile(configPath("master.key", root), "utf8") === master);
  assert.ok(await readFile(configPath("session.key", root), "utf8") === session);
  for (const name of dataDirectories) {
    assert.equal((await lstat(join(root, name))).mode & 0o777, 0o700);
  }
  for (const name of ["bootstrap.json", "master.key", "session.key", "bootstrap.lock"]) {
    assert.equal((await lstat(configPath(name, root))).mode & 0o777, 0o600);
  }
});

test("an attempted concurrent claim can create the file only once", async (t) => {
  const root = await temporaryRoot(t);
  await initializeData(root);
  const path = configPath("admin.json", root);
  const results = await Promise.all([createPrivateFile(path, "first"), createPrivateFile(path, "second")]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await readFile(path, "utf8"), results[0] ? "first" : "second");
});

test("initialization rejects a symlink in place of a data directory", async (t) => {
  const root = await temporaryRoot(t);
  await symlink(tmpdir(), join(root, "files"));
  await assert.rejects(initializeData(root), /cannot be symlinks/);
});

test("initialization rejects readable-by-others configuration files", async (t) => {
  const root = await temporaryRoot(t);
  await initializeData(root);
  const admin = configPath("admin.json", root);
  await writeFile(admin, "{}", { mode: 0o600 });
  await chmod(admin, 0o644);
  await assert.rejects(initializeData(root), /must be private/);
});
