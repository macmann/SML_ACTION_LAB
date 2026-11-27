import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { configPath, createPrivateFile, dataRoot, readOptionalPrivateFile, readPrivateFile } from "../lib/data.mjs";

export const dataDirectories = ["config", "files", "artifacts", "tmp", "models"];

async function privateDirectory(path) {
  await mkdir(path, { mode: 0o700, recursive: true });
  const info = await lstat(path);
  if (!info.isDirectory() || info.uid !== process.getuid()) {
    throw new Error("Data directories must be owned by the application user and cannot be symlinks.");
  }
  await chmod(path, 0o700);
}

export async function initializeData(root = dataRoot) {
  await privateDirectory(root);
  for (const name of dataDirectories) await privateDirectory(join(root, name));
  const admin = await readOptionalPrivateFile(configPath("admin.json", root));
  const pairingPath = configPath("pairing-code", root);
  if (admin === null) {
    if (await readOptionalPrivateFile(pairingPath) === null) {
      await createPrivateFile(pairingPath, randomBytes(24).toString("base64url") + "\n");
    }
    await readPrivateFile(pairingPath);
  }
}
