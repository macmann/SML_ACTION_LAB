import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { createHeavyQueue } from "../lib/heavy-jobs.mjs";
import { validateAudio, withSpeechTemp, runNative, hasSpeechEnergy, transcribe } from "../lib/speech-native.mjs";
import { aggregateArena, reportedUsage, scoreRoute } from "../lib/arena-scoring.mjs";

const wav = (length) => {
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(length + 36, 4);
  header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(length, 40);
  return Buffer.concat([header, Buffer.alloc(length)]);
};

test("rejects audio signature and MIME mismatch, and detects silent PCM", () => {
  assert.equal(validateAudio(wav(32000), "audio/wav"), "wav");
  assert.throws(() => validateAudio(wav(32000), "audio/mp4"), /unsupported/);
  assert.throws(() => validateAudio(Buffer.from("../../model.wav"), "audio/wav"), /unsupported/);
  assert.equal(hasSpeechEnergy(Buffer.alloc(32000)), false);
  assert.equal(hasSpeechEnergy(Buffer.alloc(32000, 123)), true);
});

test("one heavy job runs, three queue, overflow and queued cancellation fail visibly", async () => {
  const run = createHeavyQueue();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = run(() => gate);
  const cancelled = new AbortController();
  const waiting = [run(() => 1, cancelled.signal), run(() => 2), run(() => 3)];
  await assert.rejects(run(() => 4), { status: 429 });
  cancelled.abort();
  await assert.rejects(waiting[0], { status: 408 });
  release("done");
  assert.equal(await first, "done");
  assert.deepEqual(await Promise.all(waiting.slice(1)), [2, 3]);
});

test("native timeout kills the process and a failed job removes its private temp directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "slm-speech-tests-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(withSpeechTemp(async (cwd) => {
    await writeFile(join(cwd, "sample"), "temporary");
    await runNative(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeout: 200, cwd });
  }, root), { status: 504 });
  assert.deepEqual(await readdir(root), []);
});

test("real FFmpeg decodes silence without invoking a model when FFmpeg is available", async (t) => {
  const { access } = await import("node:fs/promises");
  try { await access("/usr/bin/ffmpeg"); } catch { t.skip("FFmpeg is absent"); return; }
  const root = await mkdtemp(join(tmpdir(), "slm-ffmpeg-tests-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await transcribe(wav(32000), "audio/wav", { model: "base", maxSeconds: 5, language: "en" },
    undefined, { ffmpeg: "/usr/bin/ffmpeg", whisper: "/nonexistent" }, root, root);
  assert.deepEqual(result, { transcript: "", noSpeech: true });
  assert.deepEqual(await readdir(root), []);
});

test("Arena normalizes native object arguments and excludes unattributed runs from verified tuned counts", () => {
  const expected = { name: "search_documents", arguments: { query: "Fixture" } };
  const response = { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", tool_calls: [{
    id: "fixture", type: "function", function: expected,
  }] } }] };
  const result = scoreRoute(response, expected);
  assert.equal(result.exact, true);
  assert.equal(reportedUsage(response), undefined);
  assert.deepEqual(reportedUsage({ usage: { total_tokens: 12, completion_tokens: -1 } }), { total_tokens: 12 });
  const row = { model: "fixture", result: { ...result, mode: "routing", provider: "distil", variant: "tuned" } };
  const scores = aggregateArena([
    { ...row, result: { ...row.result, identity: "attested" } },
    { ...row, result: { ...row.result, identity: "unverified" } },
  ]);
  assert.deepEqual(scores.map((score) => [score.key.split(" / ").at(-1), score.total]), [["verified tuned", 1], ["unverified", 1]]);
});
