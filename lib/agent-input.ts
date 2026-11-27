import { WorkspaceError } from "./database";

export async function boundedJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new WorkspaceError("Send a JSON request.", 415);
  }
  const max = 16_384;
  if (Number(request.headers.get("content-length")) > max) throw new WorkspaceError("The request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new WorkspaceError("The request is empty.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  const timeout = AbortSignal.timeout(6000);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  timeout.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) throw new WorkspaceError("The request is too large.", 413);
      chunks.push(value);
    }
  } finally {
    timeout.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (timeout.aborted || request.signal.aborted) throw new WorkspaceError("The request was interrupted.", 408);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length))) as unknown; }
  catch { throw new WorkspaceError("The request contains invalid JSON."); }
}
