import { lstat, opendir, statfs } from "node:fs/promises";
import { join } from "node:path";
import { dataRoot } from "./data.mjs";

export const objectLimit = 3 * 1024 ** 3;
export const freeReserve = 256 * 1024 ** 2;
const entryLimit = 20_000;

export async function storageCapacity() {
  let objects = 0;
  let bytes = 0;
  let entries = 0;
  for (const storage of ["files", "artifacts"]) {
    const base = join(/* turbopackIgnore: true */ dataRoot, storage);
    if (!(await lstat(base)).isDirectory()) throw new Error("Invalid workspace storage.");
    for await (const namespace of await opendir(base)) {
      if (++entries > entryLimit || !namespace.isDirectory()) throw new Error("Invalid workspace storage.");
      const path = join(base, namespace.name);
      for await (const file of await opendir(path)) {
        if (++entries > entryLimit || !file.isFile()) throw new Error("Invalid workspace storage.");
        const info = await lstat(join(path, file.name));
        if (!info.isFile()) throw new Error("Invalid workspace storage.");
        bytes += info.size;
        objects++;
      }
    }
  }
  const filesystem = await statfs(dataRoot);
  return { objects, bytes, limitBytes: objectLimit, freeBytes: filesystem.bavail * filesystem.bsize, reserveBytes: freeReserve };
}
