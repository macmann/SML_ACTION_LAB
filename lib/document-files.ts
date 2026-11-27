import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { dataRoot } from "./data.mjs";

export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Storage = "files" | "artifacts";

async function directory(namespace: string, storage: Storage) {
  if (!uuid.test(namespace)) throw new Error();
  const base = join(/* turbopackIgnore: true */ dataRoot, storage);
  const path = join(base, namespace);
  for (const parent of [dataRoot, base, path]) {
    if (parent === path) await mkdir(/* turbopackIgnore: true */ path, { mode: 0o700 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const info = await lstat(/* turbopackIgnore: true */ parent);
    if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw new Error();
  }
  return path;
}

async function original(namespace: string, id: string, storage: Storage) {
  if (!uuid.test(id)) throw new Error();
  return join(await directory(namespace, storage), id);
}

export async function writeOriginal(namespace: string, id: string, bytes: Buffer, storage: Storage = "files") {
  const path = await original(namespace, id, storage);
  const temporary = path + ".pending";
  const file = await open(/* turbopackIgnore: true */ temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await link(temporary, path);
  } finally {
    await unlink(temporary);
  }
  const parent = await open(await directory(namespace, storage), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await parent.sync(); } finally { await parent.close(); }
}

export async function readOriginal(namespace: string, id: string, storage: Storage = "files") {
  const file = await open(/* turbopackIgnore: true */ await original(namespace, id, storage), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw new Error();
    return { file, size: info.size };
  } catch (error) {
    await file.close();
    throw error;
  }
}

export async function removeOriginal(namespace: string, id: string, storage: Storage = "files") {
  await unlink(/* turbopackIgnore: true */ await original(namespace, id, storage)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function cleanupOriginals(namespace: string, valid: Set<string>, storage: Storage = "files") {
  const path = await directory(namespace, storage);
  for (const name of await readdir(/* turbopackIgnore: true */ path)) {
    if ((!uuid.test(name) && !uuid.test(name.replace(/\.pending$/, ""))) || valid.has(name)) continue;
    const candidate = join(path, name);
    const info = await lstat(/* turbopackIgnore: true */ candidate);
    if (info.isFile() && Date.now() - info.mtimeMs > 60 * 60 * 1000) {
      await unlink(candidate).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
  }
}
