import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename } from "node:fs/promises";
import { join } from "node:path";
import { dataRoot } from "./data.mjs";

const file = join(dataRoot, "config", "operations.jsonl");
const guard = Symbol.for("slm.operations");
const state = globalThis[guard] ??= { tail: Promise.resolve() };
const flags = constants.O_NOFOLLOW | constants.O_NONBLOCK;
const limit = 192 * 1024;

export async function operationEvents() {
  try {
    const handle = await open(file, constants.O_RDONLY | flags);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > limit + 4096) return [];
      return (await handle.readFile("utf8")).trim().split("\n").flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
      }).reverse();
    } finally { await handle.close(); }
  } catch { return []; }
}

// Callers supply controlled event names and sanitized details only.
export async function recordOperation(component, type, details = {}) {
  const event = { timestamp: new Date().toISOString(), severity: details.error ? "error" : "info",
    component, type, correlationId: randomUUID(), ...details };
  const line = JSON.stringify(event) + "\n";
  const task = state.tail.then(async () => {
    const handle = await open(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | flags, 0o600);
    let rotate = false;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) || line.length > 4096) return;
      rotate = info.size + Buffer.byteLength(line) > limit;
      if (!rotate) await handle.writeFile(line);
    } finally { await handle.close(); }
    if (rotate) {
      await rename(file, file + ".previous");
      const next = await open(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | flags, 0o600);
      try { await next.writeFile(line); } finally { await next.close(); }
    }
  });
  state.tail = task.catch(() => {});
  await state.tail;
}
