import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import { configPath, createPrivateFile, dataRoot, readOptionalPrivateFile } from "./data.mjs";

const derive = promisify(scrypt);
const strong = { N: 2 ** 17, r: 8, p: 1, maxmem: 160 * 1024 ** 2 };
export const sessionDuration = 8 * 60 * 60;
const tokenDuration = 15 * 60 * 1000;
const hexKey = /^[a-f0-9]{64}$/;
const digest = (token) => createHash("sha256").update(token).digest("hex");
const random = () => randomBytes(32).toString("hex");

function safeEqual(a, b) {
  return typeof a === "string" && typeof b === "string" && a.length === b.length &&
    Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function bootstrap(root = dataRoot) {
  const path = (name) => configPath(name, root);
  const read = (name) => readOptionalPrivateFile(path(name));

  async function lock(operation) {
    const file = path("bootstrap.lock");
    if (await read("bootstrap.lock") === null) await createPrivateFile(file, "");
    // The kernel releases the lock when the child sees EOF, including if Node is killed.
    const child = spawn("flock", [
      "--exclusive", "--nonblock", file, "sh", "-c", 'printf "locked\\n"; cat >/dev/null',
    ], { stdio: ["pipe", "pipe", "ignore"] });
    child.stdin.on("error", () => {});
    const closed = new Promise((resolve) => child.once("close", resolve));
    const acquired = new Promise((resolve) => {
      child.stdout.once("data", () => resolve(true));
      child.once("error", () => resolve(false));
      child.once("close", () => resolve(false));
    });
    try {
      if (!await acquired) throw new Error("Bootstrap storage is busy or its lock is unavailable.");
      return await operation();
    } finally {
      child.stdin.end();
      await closed;
    }
  }

  async function write(state) {
    const target = path("bootstrap.json");
    const temporary = target + "." + random();
    const file = await open(/*turbopackIgnore: true*/ temporary, "wx", 0o600);
    try {
      try {
        await file.writeFile(JSON.stringify(state));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, target);
      const directory = await open(path("."), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
  }

  async function key(name) {
    const material = await read(name);
    if (!material || !hexKey.test(material)) throw new Error("Persistent bootstrap key is missing or invalid.");
    return Buffer.from(material, "hex");
  }

  async function load() {
    const raw = await read("bootstrap.json");
    if (raw === null) throw new Error("Bootstrap storage is unavailable.");
    try {
      const state = JSON.parse(raw);
      if (state.version !== 1 || !state.settings || !state.attempts || !Number.isSafeInteger(state.revision)) throw new Error();
      return state;
    } catch {
      throw new Error("Bootstrap storage is invalid.");
    }
  }

  async function initialize() {
    return lock(async () => {
      const existing = await read("bootstrap.json");
      if (existing === null) {
        const legacy = await read("admin.json");
        const state = { version: 1, revision: 0, admin: null, token: null, attempts: {}, settings: {} };
        if (legacy !== null) {
          let account;
          try { account = JSON.parse(legacy); } catch { throw new Error("Legacy administrator storage is invalid."); }
          if (!/^[a-f0-9]{32}$/.test(account?.salt) || !/^[a-f0-9]{128}$/.test(account?.passwordHash)) {
            throw new Error("Legacy administrator storage is invalid.");
          }
          state.admin = { salt: account.salt, hash: account.passwordHash, scheme: "legacy", epoch: random() };
        }
        for (const name of ["master.key", "session.key"]) {
          if (await read(name) === null) await createPrivateFile(path(name), random());
          await key(name);
        }
        await write(state);
      }
      await key("master.key");
      await key("session.key");
      await load();
      for (const name of ["pairing-code", "admin.json"]) {
        if (await read(name) !== null) await unlink(path(name));
      }
    });
  }

  async function passwordRecord(password) {
    const salt = randomBytes(16).toString("hex");
    const hash = await derive(password, salt, 64, strong);
    return { salt, hash: hash.toString("hex"), scheme: "scrypt-v1", epoch: random() };
  }

  function permit(state, scope) {
    const previous = state.attempts[scope];
    const active = previous && previous.until > Date.now();
    if (active && previous.count >= 5) return false;
    state.attempts[scope] = active
      ? { count: previous.count + 1, until: previous.until }
      : { count: 1, until: Date.now() + 60_000 };
    return true;
  }

  async function rotateToken() {
    return lock(async () => {
      const state = await load();
      if (state.admin) throw new Error("The instance is already claimed.");
      const token = randomBytes(32).toString("base64url");
      state.token = { hash: digest(token), expires: Date.now() + tokenDuration };
      delete state.attempts.claim;
      await write(state);
      return token;
    });
  }

  async function verifyPassword(admin, password) {
    const derived = await derive(password, admin.salt, 64, admin.scheme === "legacy" ? {} : strong);
    return safeEqual(derived.toString("hex"), admin.hash);
  }

  async function authenticate(scope, password, token = "") {
    return lock(async () => {
      const state = await load();
      if ((scope === "claim") === Boolean(state.admin)) return null;
      if (!permit(state, scope)) return null;
      // Record the attempt before running scrypt, including across process interruption.
      await write(state);
      if (scope === "claim") {
        const record = state.token;
        const matches = safeEqual(digest(token), record?.hash ?? "0".repeat(64));
        if (!record || !matches || record.expires <= Date.now()) return null;
        state.admin = await passwordRecord(password);
        state.token = null;
      } else {
        const admin = state.admin;
        if (!await verifyPassword(admin, password)) return null;
        state.admin = admin.scheme === "legacy" ? await passwordRecord(password) : { ...admin, epoch: random() };
      }
      delete state.attempts[scope];
      await write(state);
      return state.admin.epoch;
    });
  }

  async function resetPassword(password) {
    return lock(async () => {
      const state = await load();
      if (!state.admin) throw new Error("Claim the instance before resetting the administrator password.");
      state.admin = await passwordRecord(password);
      delete state.attempts.login;
      delete state.attempts.password;
      await write(state);
    });
  }

  async function changePassword(epoch, current, replacement) {
    return lock(async () => {
      const state = await load();
      if (state.admin?.epoch !== epoch || !permit(state, "password")) return null;
      await write(state);
      if (!await verifyPassword(state.admin, current)) return null;
      state.admin = await passwordRecord(replacement);
      delete state.attempts.password;
      delete state.attempts.login;
      await write(state);
      return state.admin.epoch;
    });
  }

  async function revoke(epoch) {
    await lock(async () => {
      const state = await load();
      if (state.admin?.epoch !== epoch) return;
      state.admin.epoch = random();
      await write(state);
    });
  }

  async function createSession(epoch) {
    const payload = Math.floor(Date.now() / 1000 + sessionDuration) + "." + epoch;
    return payload + "." + createHmac("sha256", await key("session.key")).update(payload).digest("base64url");
  }

  async function validSession(state, token = "") {
    const match = /^(\d{1,12})\.([a-f0-9]{64})\.([\w-]{43})$/.exec(token);
    if (!match || !state.admin || !safeEqual(match[2], state.admin.epoch) || Number(match[1]) <= Date.now() / 1000) return false;
    const expected = createHmac("sha256", await key("session.key")).update(match[1] + "." + match[2]).digest("base64url");
    return safeEqual(match[3], expected);
  }

  async function encrypt(field, value) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", await key("master.key"), nonce);
    cipher.setAAD(Buffer.from("slm-config:v1:" + field));
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return { version: /** @type {1} */ (1), nonce: nonce.toString("base64url"), data: data.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
  }

  async function decrypt(field, envelope) {
    try {
      if (envelope.version !== 1) throw new Error();
      const nonce = Buffer.from(envelope.nonce, "base64url");
      if (nonce.length !== 12) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", await key("master.key"), nonce, { authTagLength: 16 });
      decipher.setAAD(Buffer.from("slm-config:v1:" + field));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("The encrypted setting could not be opened.");
    }
  }

  async function saveSettings(revision, epoch, settings) {
    return lock(async () => {
      const state = await load();
      if (state.revision !== revision || state.admin?.epoch !== epoch) return false;
      state.settings = settings;
      state.revision++;
      await write(state);
      return true;
    });
  }

  return { initialize, load, rotateToken, authenticate, resetPassword, changePassword, revoke, createSession, validSession, encrypt, decrypt, saveSettings };
}

export const store = bootstrap();
