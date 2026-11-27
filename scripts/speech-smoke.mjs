import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runNative, speechCapabilities, synthesize, transcribe, validateAudio, withSpeechTemp } from "../lib/speech-native.mjs";
import { initializeData } from "./data-layout.mjs";

await initializeData();
const options = { enabled: true, model: "base", maxSeconds: 60, language: "en", readAloud: true };
const capabilities = await speechCapabilities(options);
if (!capabilities.ffmpeg) throw new Error("Install the pinned speech image before running the CPU smoke fixture.");
const phrase = "The quick brown fox jumps over the lazy dog.";
const fixtureStart = performance.now();
const fixture = await withSpeechTemp(async (cwd) => {
  const file = join(cwd, "synthetic.wav");
  await runNative("/usr/bin/ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
    "-i", "flite=text=" + phrase + ":voice=slt", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", file], { cwd, timeout: 10000 });
  const bytes = await readFile(file);
  assert.equal(validateAudio(bytes, "audio/wav"), "wav");
  assert.ok(bytes.length > 16000);
  return bytes;
});
console.log("Synthesized real speech with offline FFmpeg flite. Fixture WAV bytes:", fixture.length,
  "Elapsed ms:", Math.round(performance.now() - fixtureStart));
if (capabilities.stt) {
  const start = performance.now();
  const result = await transcribe(fixture, "audio/wav", options);
  assert.match(result.transcript.toLowerCase(), /quick brown fox/);
  assert.match(result.transcript.toLowerCase(), /lazy dog/);
  console.log("Whisper Base phrase check passed on two CPU threads. Elapsed ms:", Math.round(performance.now() - start));
} else {
  console.log("SKIP Whisper transcription. The executable or verified model bundle is missing.");
}
if (capabilities.tts) {
  const start = performance.now();
  const output = await synthesize(phrase, options);
  assert.equal(validateAudio(output, "audio/wav"), "wav");
  console.log("Piper WAV smoke passed. Elapsed ms:", Math.round(performance.now() - start));
} else {
  console.log("SKIP Piper synthesis. The executable or verified voice bundle is missing.");
}
const [peak, limit] = await Promise.all(["memory.peak", "memory.max"].map((file) =>
  readFile(join("/sys/fs/cgroup", file), "utf8").catch(() => "")));
const expectedMemoryLimit = process.argv[2];
if (/^\d+$/.test(expectedMemoryLimit ?? "") && limit.trim() === expectedMemoryLimit &&
    /^\d+$/.test(peak.trim()) && Number(peak) <= Number(limit)) {
  console.log("Memory-limited container cgroup peak bytes:", Number(peak));
} else {
  console.log("Container memory peak is unavailable. Node process peak KiB, excluding subprocesses:",
    process.resourceUsage().maxRSS);
}
