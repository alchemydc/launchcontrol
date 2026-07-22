# launchcontrol — single full-workspace image.
#
# Deliberately NOT a Next standalone build: the ingest CLI (tsx scripts,
# Prisma CLI for migrate deploy, poppler's pdftotext) needs the full
# workspace anyway, so one image serves the web process, the ingest
# sidecar, and boot-time migrations. Multi-arch: builds natively on
# linux/arm64 (Apple Silicon dev) and linux/amd64 (deploy targets) —
# cross-build with:  docker buildx build --platform linux/amd64 .
FROM node:22-slim

# python3/make/g++: node-gyp fallback for better-sqlite3 when no prebuilt
# binary matches. poppler-utils: pdftotext for the RMsolo ingest CLI.
# openssl: Prisma engine runtime dependency on Debian slim.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ poppler-utils openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

# Manifests + prisma schema first for layer-cached installs (the web
# package's postinstall runs `prisma generate`, which needs the schema).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/web/prisma apps/web/prisma
RUN pnpm install --frozen-lockfile

COPY . .
# tsx --env-file=.env (used by the CLI scripts) errors if the file is
# absent; real config arrives via container env vars, so an empty file
# is correct here. Secrets are never baked (.env is dockerignored).
RUN touch apps/web/.env
# Build-time placeholder only — the app reads the real DATABASE_URL from
# the container environment at runtime.
ENV DATABASE_URL="file:./build-placeholder.db"
RUN pnpm --filter web build

EXPOSE 3000
CMD ["pnpm", "--filter", "web", "start"]
