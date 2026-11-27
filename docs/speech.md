# Local speech

Use the optional speech build on Linux x86-64 with AVX2. It runs in the same app container on the same persistent volume. The base image boots and displays capability diagnostics without the speech binaries or models.

```sh
docker compose -f compose.yaml -f compose.speech.yaml up -d --build
```

In Coolify, choose the `speech-runtime` build target or apply the Compose override. HTTPS and browser microphone permission are required for push-to-talk. In Settings, enable speech, select Whisper Base and a language, and optionally enable read-aloud. Review the recognized text and copy it into the editable chat box. Send it as a separate action. Speech processing stays inside the app container.

## Install models

Obtain the multilingual `ggml-base.bin` from the whisper.cpp model repository and `en_US-lessac-low.onnx`, `en_US-lessac-low.onnx.json` and `MODEL_CARD` from the Piper `en/en_US/lessac/low` directory. Review the voice model card and its dataset terms before use. Obtain trusted SHA-256 values for all four files and save them as a JSON object keyed by exact filename. Retain the bundle and lock together for repeatable installs. [Whisper model repository](https://huggingface.co/ggerganov/whisper.cpp) · [Piper Lessac Low files](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/lessac/low)

Copy the files and JSON lock to a temporary directory readable by UID 1000 inside the running container. From the app terminal, run the installer as UID 1000 and then remove the temporary inputs.

```sh
node scripts/install-speech-models.mjs /tmp/speech-input /tmp/speech-input/sha256.json
node scripts/speech-smoke.mjs
```

The installer verifies the supplied SHA-256 lock and recorded upstream digests and sizes before publishing verified files under `/app/data/models/speech`. Back up that directory with the volume. There are no model downloads during requests, and binaries and model presence are reported separately in Settings. To verify either model while offline, run the smoke script on a network-disabled container with the installed volume. It synthesizes a fixed English phrase locally, asserts the Whisper transcript and validates the Piper output when their model bundles are present. It reports elapsed time. For a container started with a memory limit, pass that limit in bytes as the first script argument to report a matching cgroup peak. The fallback reports Node process peak RSS only.

## Limits and provenance

The browser stops recording at the configured limit, up to 60 seconds. The server caps the input at 8 MiB, checks permitted media signatures, and decodes through FFmpeg using local pipes. Whisper uses two CPU threads. Speech and Office share one running job and three waiting slots per app process. Saturation and missing capabilities surface in the UI, and ordinary typed chat remains available. Each native job gets a private temporary directory and a bounded deadline.

The speech image builds pinned whisper.cpp v1.8.3 (MIT), installs Debian FFmpeg 5.1.9 (distribution copyright details in the image), and packages the archived Piper CPU release 2023.11.14-2 (MIT project license). The Piper distribution bundles native dependencies. Refer to their upstream license terms and the separate model card. [whisper.cpp v1.8.3](https://github.com/ggml-org/whisper.cpp/tree/v1.8.3) · [Piper release](https://github.com/rhasspy/piper/releases/tag/2023.11.14-2) · [Debian FFmpeg](https://packages.debian.org/bookworm/ffmpeg)
