import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdtemp, open, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataRoot } from "./data.mjs";
import { heavyJob, HeavyJobError } from "./heavy-jobs.mjs";

export const maxAudioBytes = 8 * 1024 * 1024;
export const mimeTypes = ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"];
const formats = { "audio/webm": "matroska", "audio/ogg": "ogg", "audio/mp4": "mov", "audio/wav": "wav" };
const kind = (mime) => mime.split(";")[0].trim().toLowerCase();
const bin = { ffmpeg: "/usr/bin/ffmpeg", whisper: "/opt/slm-speech/bin/whisper-cli", piper: "/opt/slm-speech/piper/piper" };

export function validateAudio(bytes, mime) {
  const type = kind(mime);
  const text = (from, to) => bytes.subarray(from, to).toString("ascii");
  const matches = {
    "audio/webm": bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
    "audio/ogg": text(0, 4) === "OggS",
    "audio/mp4": text(4, 8) === "ftyp",
    "audio/wav": text(0, 4) === "RIFF" && text(8, 12) === "WAVE",
  };
  if (!Object.hasOwn(formats, type) || !matches[type]) throw new HeavyJobError("The recording format or audio signature is unsupported.", 415);
  if (bytes.length < 32 || bytes.length > maxAudioBytes) throw new HeavyJobError("The recording exceeds the supported size or is empty.", 413);
  return formats[type];
}

async function regular(path) {
  try { const info = await lstat(path); return info.isFile() && info.size > 0; } catch { return false; }
}
async function executable(path) {
  try { await access(path, constants.X_OK); return true; } catch { return false; }
}

const base = "ggml-base.bin";
const modelFiles = { base };
const voice = "en_US-lessac-low.onnx";
const modelRoot = join(dataRoot, "models", "speech");

export async function speechCapabilities(config) {
  const model = config.model === "off" ? null : join(modelRoot, modelFiles[config.model] ?? base);
  const voicePath = join(modelRoot, voice);
  const installed = await regular(join(modelRoot, "checksums.json"));
  const [ffmpeg, whisper, piper, whisperModel, piperVoice, voiceConfig] = await Promise.all([
    executable(bin.ffmpeg), executable(bin.whisper), executable(bin.piper), model && installed ? regular(model) : false,
    installed && regular(voicePath), installed && regular(voicePath + ".json"),
  ]);
  return { ffmpeg, whisper, piper, whisperModel, piperVoice: piperVoice && voiceConfig,
    stt: config.enabled && Boolean(model) && ffmpeg && whisper && whisperModel,
    tts: config.enabled && config.readAloud && piper && piperVoice && voiceConfig,
    model: config.model, language: config.language, maxSeconds: config.maxSeconds };
}

export function runNative(binary, args, { signal, timeout, cwd, input, env }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new HeavyJobError("The recording job was cancelled.", 408)); return; }
    const child = spawn(binary, args, { cwd, detached: true, stdio: [input ? "pipe" : "ignore", "ignore", "pipe"],
      env: { HOME: cwd, PATH: "/usr/bin:/bin", LANG: "C.UTF-8", OMP_NUM_THREADS: "2", ...env } });
    let stopped;
    let diagnostic = Buffer.alloc(0);
    child.stdin?.on("error", () => {});
    child.stderr.on("data", (chunk) => {
      if (diagnostic.length < 4096) diagnostic = Buffer.concat([diagnostic, chunk.subarray(0, 4096 - diagnostic.length)]);
    });
    const kill = (reason) => {
      stopped = reason;
      if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ }
    };
    const cancel = () => kill(new HeavyJobError("The speech job was cancelled.", 408));
    const timer = setTimeout(() => kill(new HeavyJobError("The speech process timed out.", 504)), timeout);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    if (input) child.stdin?.end(input);
    child.once("error", () => { stopped ??= new HeavyJobError("The speech executable could not start.", 503); });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (stopped) reject(stopped);
      else if (code !== 0) reject(new HeavyJobError("The native speech process rejected the input or failed.", 422));
      else resolve(undefined);
    });
  });
}

async function boundedFile(path, max) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > max) throw new HeavyJobError("Speech output exceeded its size limit.", 422);
    return await handle.readFile();
  } finally { await handle.close(); }
}

function samples(wav) {
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.subarray(offset, offset + 4).toString("ascii");
    const length = wav.readUInt32LE(offset + 4);
    if (offset + 8 + length > wav.length) break;
    if (id === "data") return wav.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + (length % 2);
  }
  throw new HeavyJobError("The decoded audio is invalid.", 422);
}

export function hasSpeechEnergy(data) {
  let energetic = 0;
  for (let i = 0; i + 1 < data.length; i += 2) {
    if (Math.abs(data.readInt16LE(i)) > 120 && ++energetic > 320) return true;
  }
  return false;
}

export async function withSpeechTemp(run, root = join(dataRoot, "tmp")) {
  const path = await mkdtemp(join(root, "speech-"));
  try { return await run(path); }
  finally { await rm(path, { recursive: true, force: true }); }
}

export function transcribe(bytes, mime, config, signal, runtime = bin, root = modelRoot, tempRoot) {
  const format = validateAudio(bytes, mime);
  return heavyJob(() => withSpeechTemp(async (cwd) => {
    if (runtime === bin && !(await speechCapabilities(config)).stt) throw new HeavyJobError("Local transcription is disabled or missing its executable or model.", 503);
    const wav = join(cwd, "audio.wav");
    await runNative(runtime.ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "2",
      "-protocol_whitelist", "pipe", "-f", format, "-i", "pipe:0", "-map", "0:a:0", "-vn", "-sn", "-dn",
      "-t", String(config.maxSeconds + 1), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-f", "wav", wav],
    { signal, timeout: 15000, cwd, input: bytes });
    const pcm = samples(await boundedFile(wav, 2_100_000));
    if (pcm.length > config.maxSeconds * 32000) throw new HeavyJobError("The recording exceeds the configured duration.", 413);
    if (!hasSpeechEnergy(pcm)) return { transcript: "", noSpeech: true };
    const prefix = join(cwd, "transcript");
    await runNative(runtime.whisper, ["-m", join(root, modelFiles[config.model] ?? base), "-f", wav, "-t", "2",
      "-l", config.language, "-nt", "-otxt", "-of", prefix, "-np"], { signal, timeout: 55000, cwd });
    const transcript = (await boundedFile(prefix + ".txt", 32_768)).toString("utf8").trim()
      .replace(/\[(?:BLANK_AUDIO|NO_SPEECH|SILENCE)\]|\((?:silence|no speech)\)/gi, "").trim();
    return { transcript, noSpeech: !transcript };
  }, tempRoot), signal);
}

export function synthesize(text, config, signal) {
  return heavyJob(() => withSpeechTemp(async (cwd) => {
    if (!(await speechCapabilities(config)).tts) throw new HeavyJobError("Local read-aloud is disabled or missing its executable or voice.", 503);
    const wav = join(cwd, "speech.wav");
    const model = join(modelRoot, voice);
    await runNative(bin.piper, ["--model", model, "--config", model + ".json", "--output_file", wav],
      { signal, timeout: 30000, cwd, input: Buffer.from(text + "\n"), env: { LD_LIBRARY_PATH: dirname(bin.piper) } });
    const output = await boundedFile(wav, 8 * 1024 * 1024);
    validateAudio(output, "audio/wav");
    return output;
  }), signal);
}
