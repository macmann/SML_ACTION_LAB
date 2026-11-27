import { z } from "zod";
import { authenticated, failure, json, privateHeaders } from "@/lib/document-api";
import { boundedJson } from "@/lib/agent-input";
import { store } from "@/lib/bootstrap.mjs";
import { defaultSpeech, settingsFrom } from "@/lib/settings";
import { maxAudioBytes, speechCapabilities, synthesize, transcribe } from "@/lib/speech-native.mjs";
import { HeavyJobError } from "@/lib/heavy-jobs.mjs";
import { WorkspaceError } from "@/lib/database";

export const dynamic = "force-dynamic";
const config = async () => settingsFrom(await store.load()).speechSettings ?? defaultSpeech;

async function audio(request: Request) {
  if (Number(request.headers.get("content-length")) > maxAudioBytes) throw new WorkspaceError("Recording exceeds 8 MiB.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new WorkspaceError("Recording is empty.");
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > maxAudioBytes) throw new WorkspaceError("Recording exceeds 8 MiB.", 413);
      chunks.push(next.value);
    }
    if (signal.aborted) throw new WorkspaceError("The recording upload was interrupted.", 408);
    return Buffer.concat(chunks);
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

export async function GET() {
  try { await authenticated(); return json(await speechCapabilities(await config())); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    await authenticated(true);
    const options = await config();
    const operation = new URL(request.url).searchParams.get("operation");
    if (operation === "transcribe") {
      return json(await transcribe(await audio(request), request.headers.get("content-type") ?? "", options, request.signal));
    }
    if (operation === "read") {
      const value = z.strictObject({ text: z.string().trim().min(1).max(1600) }).safeParse(await boundedJson(request));
      if (!value.success) throw new WorkspaceError("Read-aloud requires text of at most 1,600 characters.");
      const bytes = await synthesize(value.data.text, options, request.signal);
      return new Response(new Uint8Array(bytes), { headers: { ...privateHeaders, "Content-Type": "audio/wav" } });
    }
    throw new WorkspaceError("Choose transcription or read-aloud.");
  } catch (error) {
    if (error instanceof HeavyJobError) return json({ error: error.message }, error.status);
    return failure(error);
  }
}
