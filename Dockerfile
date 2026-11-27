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

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
RUN install -d -m 0755 /app/lib /app/scripts
COPY --chmod=0644 lib/data.mjs ./lib/data.mjs
COPY --chmod=0644 scripts/data-layout.mjs scripts/init-data.mjs ./scripts/
# Docker copies ownership into an empty named volume from this directory.
RUN install -d -o node -g node -m 0700 /app/data /app/data/config
USER node
EXPOSE 3000
CMD ["sh", "-c", "umask 077 && node scripts/init-data.mjs && exec node server.js"]
