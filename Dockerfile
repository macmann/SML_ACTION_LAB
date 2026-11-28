FROM node:24.22.3-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS base
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --no-fund

FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build && chmod -R a+rX .next/standalone .next/static

FROM base AS speech-native
RUN apt-get update && apt-get install -y --no-install-recommends cmake=3.25.1-1 g++=4:12.2.0-3 make=4.3-4.1 && rm -rf /var/lib/apt/lists/*
ADD --checksum=sha256:089b898aa83b24a8321e0fd554eeb0967fb03dd687e27f6374c72d3363b5b429 https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/2eeeba56e9edd762b4b38467bab96c2517163158 /tmp/whisper.tar.gz
ADD --checksum=sha256:a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992 https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz /tmp/piper.tar.gz
ADD --checksum=sha256:4cd71dece7037f1d6d93cce7570c57ab75ea9ac566fd4990be2f3ab08d15b47f https://raw.githubusercontent.com/rhasspy/piper/38917ffd8c0e219c6581d73e07b30ef1d572fce1/LICENSE.md /tmp/piper-LICENSE.md
RUN test "$(dpkg --print-architecture)" = amd64 \
    && mkdir -p /tmp/whisper /opt/slm-speech/bin /opt/slm-speech/licenses \
    && tar -xzf /tmp/whisper.tar.gz --strip-components=1 -C /tmp/whisper \
    && tar -xzf /tmp/piper.tar.gz -C /opt/slm-speech \
    && cmake -S /tmp/whisper -B /tmp/whisper/build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
       -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DGGML_CUDA=OFF -DGGML_VULKAN=OFF -DWHISPER_SDL2=OFF \
    && cmake --build /tmp/whisper/build --target whisper-cli --parallel 2 \
    && install -m 0755 /tmp/whisper/build/bin/whisper-cli /opt/slm-speech/bin/whisper-cli \
    && install -m 0644 /tmp/whisper/LICENSE /opt/slm-speech/licenses/whisper-MIT.txt \
    && install -m 0644 /tmp/piper-LICENSE.md /opt/slm-speech/licenses/piper-MIT.txt

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
RUN install -d -m 0755 /app/lib /app/scripts
COPY --chmod=0644 lib/data.mjs lib/bootstrap.mjs lib/extraction.ts lib/speech-native.mjs lib/heavy-jobs.mjs ./lib/
COPY --chmod=0644 scripts/data-layout.mjs scripts/init-data.mjs scripts/operator.mjs scripts/extract-document.mjs scripts/install-speech-models.mjs scripts/speech-smoke.mjs ./scripts/
COPY --chmod=0644 speech/upstream.json ./speech/upstream.json
# Docker copies ownership into an empty named volume from this directory.
RUN install -d -o node -g node -m 0700 /app/data /app/data/config
USER node
EXPOSE 3000
CMD ["sh", "-c", "umask 077 && node scripts/init-data.mjs && exec node server.js"]


FROM runtime AS speech-runtime
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg=7:5.1.9-0+deb12u1 bubblewrap=0.8.0-2+deb12u1 util-linux=2.38.1-5+deb12u3 \
    libreoffice-writer=4:7.4.7-1+deb12u14 fonts-liberation=1:1.07.4-11 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=speech-native /opt/slm-speech /opt/slm-speech
USER node

# Native executables are bundled. Models are installed separately by the operator.
FROM speech-runtime AS default
