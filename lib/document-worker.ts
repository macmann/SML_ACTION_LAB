import { fork } from "node:child_process";
import { join } from "node:path";
import { DocumentError, type Format, type Section, type SheetData, type TableOptions } from "./extraction";
import { heavyJob, HeavyJobError } from "./heavy-jobs.mjs";
import { WorkspaceError } from "./database";

function parseIsolated<T>(bytes: Buffer, format: Format, table?: TableOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = fork(join(/* turbopackIgnore: true */ process.cwd(), "scripts/extract-document.mjs"), [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced",
      execArgv: ["--max-old-space-size=384"],
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", NODE_ENV: "production" },
    });
    type Result = { value: T } | { error: string };
    let result: Result | undefined;
    const timer = setTimeout(() => worker.kill("SIGKILL"), 25_000);
    worker.once("message", (message: Result) => { result = message; });
    worker.once("error", () => {});
    worker.once("close", () => {
      clearTimeout(timer);
      if (result && "value" in result) resolve(result.value);
      else reject(new DocumentError(result?.error ?? "The document parser failed or exceeded its processing limit."));
    });
    worker.send({ bytes, format, table }, (error) => { if (error) worker.kill(); });
  });
}

async function queuedParse<T>(bytes: Buffer, format: Format, table?: TableOptions, signal?: AbortSignal): Promise<T> {
  try {
    return await heavyJob(() => parseIsolated<T>(bytes, format, table), signal);
  } catch (error) {
    if (error instanceof HeavyJobError) throw new WorkspaceError(error.message, error.status);
    throw error;
  }
}

export function extractIsolated(bytes: Buffer, format: Format, signal?: AbortSignal) {
  return queuedParse<Section[]>(bytes, format, undefined, signal);
}

export function extractTableIsolated(bytes: Buffer, format: "csv" | "xlsx", options: TableOptions = {}) {
  return queuedParse<SheetData>(bytes, format, options);
}
