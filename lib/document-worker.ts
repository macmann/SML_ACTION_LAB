import { fork } from "node:child_process";
import { join } from "node:path";
import { DocumentError, type Format, type Section } from "./extraction";

export function extractIsolated(bytes: Buffer, format: Format): Promise<Section[]> {
  return new Promise((resolve, reject) => {
    const worker = fork(join(/* turbopackIgnore: true */ process.cwd(), "scripts/extract-document.mjs"), [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced",
      execArgv: ["--max-old-space-size=384"],
    });
    type Result = { sections: Section[] } | { error: string };
    let result: Result | undefined;
    const timer = setTimeout(() => worker.kill("SIGKILL"), 25_000);
    worker.once("message", (message: Result) => { result = message; });
    worker.once("error", () => {});
    worker.once("close", () => {
      clearTimeout(timer);
      if (result && "sections" in result) resolve(result.sections);
      else reject(new DocumentError(result?.error ?? "The document parser failed or exceeded its processing limit."));
    });
    worker.send({ bytes, format }, (error) => { if (error) worker.kill(); });
  });
}
