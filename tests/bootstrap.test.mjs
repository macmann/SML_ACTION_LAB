import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bootstrap } from "../lib/bootstrap.mjs";
import { configPath } from "../lib/data.mjs";
import { initializeData } from "../scripts/data-layout.mjs";

const fixture = () => randomBytes(20).toString("hex");
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "slm-bootstrap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initializeData(root);
  return { root, store: bootstrap(root) };
}

test("only one concurrent claimant wins and no raw token or password reaches disk", async (t) => {
  const { root, store } = await setup(t);
  const token = await store.rotateToken();
  const passwords = [fixture(), fixture(), fixture(), fixture()];
  const stored = () => readFile(configPath("bootstrap.json", root), "utf8");
  assert.ok(!(await stored()).includes(token));
  const claims = await Promise.allSettled(passwords.map((password) => store.authenticate("claim", password, token)));
  const wins = claims.filter((result) => result.status === "fulfilled" && result.value);
  assert.equal(wins.length, 1);
  assert.equal((await store.load()).token, null);
  assert.ok(passwords.every((password) => !(JSON.stringify(claims).includes(password))));
  const snapshot = await stored();
  assert.ok(passwords.every((password) => !snapshot.includes(password)));
  assert.equal(await store.authenticate("claim", fixture(), token), null);
});

test("rotated and expired tokens fail, and the rate limit persists across initialization", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const { root, store } = await setup(t);
  const old = await store.rotateToken();
  const valid = await store.rotateToken();
  const password = fixture();
  assert.equal(await store.authenticate("claim", password, old), null);
  for (let attempt = 0; attempt < 4; attempt++) {
    assert.equal(await store.authenticate("claim", password, "wrong"), null);
  }
  await initializeData(root);
  assert.equal(await bootstrap(root).authenticate("claim", password, valid), null);
  t.mock.timers.tick(16 * 60_000);
  assert.equal(await store.authenticate("claim", password, valid), null);
  assert.ok(await store.authenticate("claim", password, await store.rotateToken()));
});

test("rotation, logout, recovery and stale settings updates revoke previous authorization", async (t) => {
  const { store } = await setup(t);
  const password = fixture();
  const epoch = await store.authenticate("claim", password, await store.rotateToken());
  const token = await store.createSession(epoch);
  assert.equal(await store.validSession(await store.load(), token), true);
  assert.equal(await store.saveSettings(0, epoch, {}), true);
  assert.equal(await store.saveSettings(0, epoch, {}), false);
  const loggedIn = await store.authenticate("login", password);
  assert.equal(await store.validSession(await store.load(), token), false);
  const changed = await store.changePassword(loggedIn, password, fixture());
  assert.ok(changed && changed !== loggedIn);
  assert.equal(await store.validSession(await store.load(), await store.createSession(loggedIn)), false);
  await store.revoke(changed);
  assert.equal(await store.validSession(await store.load(), await store.createSession(changed)), false);
  const replacement = fixture();
  await store.resetPassword(replacement);
  assert.equal(await store.authenticate("login", password), null);
  assert.ok(await store.authenticate("login", replacement));
  assert.equal(await store.saveSettings(1, epoch, {}), false);
});

test("credential envelopes authenticate fields and ciphertext; missing keys fail closed", async (t) => {
  const { root, store } = await setup(t);
  const secret = fixture();
  const envelope = await store.encrypt("database", secret);
  assert.ok(envelope.nonce !== (await store.encrypt("database", secret)).nonce);
  assert.ok(!JSON.stringify(envelope).includes(secret));
  assert.ok(await store.decrypt("database", envelope) === secret);
  await assert.rejects(store.decrypt("writer", envelope), /could not be opened/);
  await assert.rejects(store.decrypt("database", { ...envelope, tag: "broken" }), /could not be opened/);
  const epoch = await store.authenticate("claim", fixture(), await store.rotateToken());
  assert.equal(await store.saveSettings(0, epoch, { database: envelope }), true);
  await unlink(configPath("master.key", root));
  await assert.rejects(initializeData(root), /key is missing/);
  await assert.rejects(readFile(configPath("master.key", root)), { code: "ENOENT" });
});

test("Phase 1 accounts migrate without keeping the legacy secret or session", async (t) => {
  const { root } = await setup(t);
  await unlink(configPath("bootstrap.json", root));
  const password = fixture();
  const salt = randomBytes(16).toString("hex");
  const legacy = { salt, passwordHash: scryptSync(password, salt, 64).toString("hex"), signingKey: fixture() };
  await writeFile(configPath("admin.json", root), JSON.stringify(legacy), { mode: 0o600 });
  await writeFile(configPath("pairing-code", root), fixture(), { mode: 0o600 });
  await initializeData(root);
  const store = bootstrap(root);
  assert.equal((await store.load()).admin.scheme, "legacy");
  assert.ok(await store.authenticate("login", password));
  assert.equal((await store.load()).admin.scheme, "scrypt-v1");
  await assert.rejects(readFile(configPath("admin.json", root)), { code: "ENOENT" });
  await assert.rejects(readFile(configPath("pairing-code", root)), { code: "ENOENT" });
});
