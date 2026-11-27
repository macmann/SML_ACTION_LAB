import { chmod, lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { dataRoot } from "../lib/data.mjs";
import { bootstrap } from "../lib/bootstrap.mjs";

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
  await bootstrap(root).initialize();
}
