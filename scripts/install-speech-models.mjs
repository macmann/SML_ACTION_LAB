import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { dataRoot, createPrivateFile } from "../lib/data.mjs";

const [, , input, lock] = process.argv;
if (!input || !lock || process.argv.length !== 4) throw new Error("Usage: node scripts/install-speech-models.mjs FILE_DIRECTORY TRUSTED_SHA256_JSON");
const { models } = JSON.parse(await readFile(new URL("../speech/upstream.json", import.meta.url), "utf8"));
const expected = JSON.parse(await readFile(resolve(lock), "utf8"));
const destination = join(dataRoot, "models", "speech");
const staging = join(dataRoot, "models", ".speech-" + randomBytes(12).toString("hex"));
const owner = process.getuid();
for (const directory of [dataRoot, join(dataRoot, "models")]) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.uid !== owner || (info.mode & 0o077)) throw new Error("The app data directory must be initialized and private.");
}
await mkdir(staging, { mode: 0o700 });
try {
  for (const [name, { algorithm, digest, size }] of Object.entries(models)) {
    if (!/^[a-f0-9]{64}$/.test(expected[name] ?? "")) throw new Error("A trusted SHA-256 is required for " + name);
    const handle = await open(join(resolve(input), name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 200 * 1024 ** 2 || (size && size !== info.size)) throw new Error("Unexpected artifact size for " + name);
      const bytes = await handle.readFile();
      if (createHash("sha256").update(bytes).digest("hex") !== expected[name] ||
          createHash(algorithm).update(bytes).digest("hex") !== digest) throw new Error("Checksum mismatch for " + name);
      const output = await open(join(staging, name), "wx", 0o600);
      try { await output.writeFile(bytes); await output.sync(); } finally { await output.close(); }
    } finally { await handle.close(); }
  }
  await mkdir(destination, { mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
  const info = await lstat(destination);
  if (!info.isDirectory() || info.uid !== owner || (info.mode & 0o077)) throw new Error("Speech model destination must be private.");
  for (const name of Object.keys(models)) {
    const path = join(destination, name);
    try { await link(join(staging, name), path); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const present = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const file = await present.stat();
        if (!file.isFile() || file.size > 200 * 1024 ** 2 ||
            createHash("sha256").update(await present.readFile()).digest("hex") !== expected[name]) {
          throw new Error("Existing model differs. Back it up and remove it before replacing " + name);
        }
      } finally { await present.close(); }
    }
  }
  const checked = JSON.stringify(Object.fromEntries(Object.keys(models).map((name) => [name, expected[name]])));
  if (!await createPrivateFile(join(destination, "checksums.json"), checked)) {
    const provenance = await open(join(destination, "checksums.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await provenance.stat()).isFile() || await provenance.readFile("utf8") !== checked) {
        throw new Error("The installed provenance record differs.");
      }
    } finally { await provenance.close(); }
  }
  await chmod(destination, 0o700);
  console.log("Pinned Whisper Base and Lessac Low files verified and installed.");
} finally { await rm(staging, { recursive: true, force: true }); }
