import { randomBytes } from "node:crypto";
import { link, lstat, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const dataRoot = resolve(process.cwd(), "data");

export function configPath(name, root = dataRoot) {
  return join(root, "config", name);
}

export async function createPrivateFile(path, content) {
  const temporary = path + "." + randomBytes(16).toString("hex");
  await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
  try {
    await link(temporary, path);
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  } finally {
    await unlink(temporary);
  }
}

export async function readPrivateFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) {
    throw new Error("Configuration files must be private regular files owned by the application user.");
  }
  return readFile(path, "utf8");
}

export async function readOptionalPrivateFile(path) {
  try {
    return await readPrivateFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
