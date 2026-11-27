import { fork } from "node:child_process";
import { join } from "node:path";
import { DocumentError, type Format, type Section, type SheetData, type TableOptions } from "./extraction";

function parseIsolated<T>(bytes: Buffer, format: Format, table?: TableOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = fork(join(/* turbopackIgnore: true */ process.cwd(), "scripts/extract-document.mjs"), [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced",
      execArgv: ["--max-old-space-size=384"],
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

export function extractIsolated(bytes: Buffer, format: Format) {
  return parseIsolated<Section[]>(bytes, format);
}

export function extractTableIsolated(bytes: Buffer, format: "csv" | "xlsx", options: TableOptions = {}) {
  return parseIsolated<SheetData>(bytes, format, options);
}
