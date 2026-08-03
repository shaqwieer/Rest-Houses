# syntax=docker/dockerfile:1
# ============================================================================
#  استراحات — production image
# ============================================================================
#  Multi-stage build producing a small, non-root, stateless runtime image.
#
#  Two things make it stateless, which is the whole point:
#    • STORAGE_DRIVER=db  → uploaded photos live in Postgres, so there is no
#      uploads volume to mount and nothing is lost on redeploy
#    • the database is external (see docker-compose.yml)
#
#  Build:  docker build -t desert-chalets .
#  Run:    docker compose up -d --build
#
#  NOTE: no database is needed at build time, and none is contacted. Every
#  build-time database read degrades gracefully (see generateStaticParams in
#  src/app/(site)/listings/[slug]/page.tsx) — coupling an image build to a live
#  database would make builds non-reproducible.
# ============================================================================

ARG NODE_VERSION=22

# ---------------------------------------------------------------------------
# base — shared by every stage
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
# openssl is required by Prisma's query engine; ca-certificates for outbound TLS
# (the OG-image route fetches its Arabic font from Google Fonts).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------------------
# deps — install node_modules (cached until package-lock.json changes)
# ---------------------------------------------------------------------------
FROM base AS deps

COPY package.json package-lock.json ./
# prisma/ is copied before `npm ci` because the `postinstall` hook runs
# `prisma generate`, which needs the schema to exist.
COPY prisma ./prisma
COPY scripts ./scripts

RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# build — compile the Next.js app
# ---------------------------------------------------------------------------
FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# A syntactically valid but unused URL. Prisma validates the connection string
# when the client is constructed; nothing here ever opens a connection.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV NODE_ENV=production

RUN npx prisma generate \
 && npx next build

# Normalise line endings on the shell scripts the containers execute. A checkout
# on Windows yields CRLF, and a CR inside a script surfaces either as the
# baffling "no such file or directory" at exec (the kernel reads the shebang as
# "/bin/sh" plus a CR) or as mangled arguments mid-script. .gitattributes pins LF
# at source; this makes the image correct regardless of how the context arrived.
# '\015' is CR written as an octal escape rather than as a literal carriage
# return, so this line survives any tooling that normalises line endings.
RUN for f in docker/*.sh; do \
      tr -d '\015' < "$f" > "$f.tmp" && mv "$f.tmp" "$f"; \
    done \
 && chmod +x docker/*.sh \
 && head -1 docker/entrypoint.sh | grep -qx '#!/bin/sh'

# ---------------------------------------------------------------------------
# runtime — only what is needed to serve
# ---------------------------------------------------------------------------
FROM base AS runtime
# TZ — the container's clock reads as Gulf time.
#
# Everything user-facing already renders through the helpers in
# src/lib/dates.ts, which apply UTC+4 explicitly and do not depend on this. It
# is set anyway so that the things those helpers do NOT touch agree with them:
# server log timestamps, `new Date()` in an ad-hoc script, and anything a
# future contributor writes before reading that file. A container whose clock
# says one thing while its pages say another is a debugging trap.
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Asia/Dubai \
    STORAGE_DRIVER=db

# Run as an unprivileged user. `node` (uid 1000) already exists in the base image.
RUN mkdir -p /app/.next/cache /app/public/uploads \
 && chown -R node:node /app

# Standalone server + its traced dependencies.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# The generated Prisma client and its query engine.
#
# Next's standalone tracer usually picks these up, but the engine is a platform
# binary resolved at runtime rather than a static import, so copying it
# explicitly removes any doubt. Note this is the CLIENT only — the Prisma *CLI*
# is deliberately absent: it drags in @prisma/config → effect → … which the
# tracer has no reason to include, and nothing in the running app needs it.
# Schema changes are applied by the `migrate` service instead.
COPY --from=build --chown=node:node /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma

# Taken from the build stage, where it was already CR-stripped, validated and
# made executable.
COPY --from=build --chown=node:node /app/docker/entrypoint.sh /usr/local/bin/entrypoint.sh

USER node
EXPOSE 3000

# Reports unhealthy if the process is up but cannot reach Postgres — so a broken
# deploy is never rolled out over a working one.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
