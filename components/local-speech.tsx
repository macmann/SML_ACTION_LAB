"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";

type Options = { stt: boolean; tts: boolean; maxSeconds: number };
type RecordingSession = { wanted: boolean; recorder?: MediaRecorder; stream?: MediaStream; timer?: ReturnType<typeof setTimeout> };
const supported = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"];

export function LocalSpeech({ onTranscript, readText }: { onTranscript: (text: string) => void; readText?: string }) {
  const [options, setOptions] = useState<Options>();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("");
  const session = useRef<RecordingSession | null>(null);
  const job = useRef<AbortController | null>(null);
  const audioUrl = useRef("");
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    fetch("/api/speech", { signal: controller.signal }).then((response) => response.ok ? response.json() : undefined)
      .then(setOptions).catch(() => {});
    return () => {
      alive.current = false;
      controller.abort(); job.current?.abort();
      const active = session.current;
      if (active) { active.wanted = false; clearTimeout(active.timer); active.stream?.getTracks().forEach((track) => track.stop()); }
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    };
  }, []);

  function stop() {
    const active = session.current;
    if (!active) return;
    active.wanted = false;
    clearTimeout(active.timer);
    if (active.recorder?.state === "recording") active.recorder.stop();
  }

  async function start() {
    if (!options?.stt || !alive.current || session.current || job.current) return;
    if (!window.isSecureContext || !navigator.mediaDevices || typeof MediaRecorder === "undefined") {
      setMessage("Recording requires HTTPS, microphone permission and MediaRecorder support."); return;
    }
    const mimeType = supported.find((mime) => MediaRecorder.isTypeSupported(mime));
    if (!mimeType) { setMessage("This browser cannot produce a supported recording format."); return; }
    const active: RecordingSession = { wanted: true };
    session.current = active;
    setMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active.wanted || !alive.current) { stream.getTracks().forEach((track) => track.stop()); session.current = null; return; }
      active.stream = stream;
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
      active.recorder = recorder;
      const chunks: Blob[] = [];
      let bytes = 0;
      let oversized = false;
      recorder.ondataavailable = ({ data }) => {
        bytes += data.size;
        if (bytes > 8 * 1024 * 1024) { oversized = true; stop(); }
        else if (data.size) chunks.push(data);
      };
      recorder.onerror = () => { setMessage("Recording failed."); stop(); };
      recorder.onstop = async () => {
        clearTimeout(active.timer);
        stream.getTracks().forEach((track) => track.stop());
        session.current = null;
        if (!alive.current) return;
        setRecording(false);
        if (oversized || !chunks.length) { setMessage(oversized ? "Recording exceeds 8 MiB." : "Recording is empty."); return; }
        const control = new AbortController();
        job.current = control;
        setBusy(true);
        try {
          const audio = new Blob(chunks, { type: recorder.mimeType });
          const response = await fetch("/api/speech?operation=transcribe", {
            method: "POST", body: audio, headers: { "Content-Type": audio.type }, signal: control.signal,
          });
          const value = await response.json();
          if (!response.ok) throw new Error(value.error);
          if (value.noSpeech) setMessage("No speech detected.");
          else { onTranscript(String(value.transcript).slice(0, 2000)); setMessage("Review or edit the transcript before running the turn."); }
        } catch (error) { if (!control.signal.aborted) setMessage((error as Error).message || "Transcription failed."); }
        finally { job.current = null; if (alive.current) setBusy(false); }
      };
      recorder.start(250);
      setRecording(true);
      active.timer = setTimeout(stop, options.maxSeconds * 1000);
    } catch {
      active.stream?.getTracks().forEach((track) => track.stop()); session.current = null;
      if (alive.current) setMessage("Microphone permission was denied or the recorder failed.");
    }
  }

  async function read() {
    if (!readText || job.current || session.current) return;
    const control = new AbortController(); job.current = control; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/speech?operation=read", { method: "POST", signal: control.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: readText.slice(0, 1600) }) });
      if (!response.ok) throw new Error((await response.json()).error);
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = URL.createObjectURL(await response.blob()); setUrl(audioUrl.current);
    } catch (error) { if (!control.signal.aborted) setMessage((error as Error).message || "Read-aloud failed."); }
    finally { job.current = null; if (alive.current) setBusy(false); }
  }

  return <section aria-label="Local speech" className="grid gap-2">
    <div className="flex flex-wrap gap-2">
      {options?.stt && <Button type="button" variant="outline" disabled={busy}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); void start(); }}
        onPointerUp={stop} onPointerCancel={stop} onClick={(event) => { if (event.detail === 0) { if (session.current) stop(); else void start(); } }}>
        {recording ? "Recording…" : "Hold to talk"}</Button>}
      {options?.tts && readText && <Button type="button" variant="outline" disabled={busy || recording} onClick={() => void read()}>Read aloud</Button>}
      {busy && <Button type="button" variant="outline" onClick={() => { job.current?.abort(); setMessage("Speech job cancelled."); }}>Cancel speech job</Button>}
    </div>
    {options && !options.stt && <p className="text-sm text-[var(--muted)]">Local transcription is unavailable. Type your request or check speech settings.</p>}
    {message && <p role="status">{message}</p>}
    {url && <audio className="max-w-full" controls src={url} aria-label="Local synthesized speech" />}
  </section>;
}
