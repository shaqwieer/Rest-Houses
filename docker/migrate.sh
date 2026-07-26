#!/bin/sh
# ============================================================================
#  One-shot schema/seed job — runs in the `migrate` compose service
# ============================================================================
#  Executed once per `docker compose up`, BEFORE the app starts, from an image
#  built at the `build` stage (which has the full node_modules, so the Prisma
#  CLI and tsx are both available).
#
#  Why this is a separate service rather than part of the app's entrypoint:
#    • the runtime image can stay minimal — no Prisma CLI, no TypeScript
#      toolchain, and no cherry-picking their transitive dependencies out of a
#      standalone build (`prisma` needs @prisma/config → effect → …, which the
#      Next standalone tracer has no reason to include)
#    • migrations must run exactly once. If every app replica applied the schema
#      on boot, scaling to two would have them racing each other.
#
#  Idempotent: safe to re-run on every deploy.
# ============================================================================
set -e

log() { echo "▸ $*"; }

log "waiting for the database…"
i=0
until node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$queryRaw\`SELECT 1\`.then(() => process.exit(0)).catch(() => process.exit(1)).finally(() => p.\$disconnect());
" >/dev/null 2>&1; do
  i=$((i + 2))
  if [ "$i" -ge "${DB_WAIT_SECONDS:-60}" ]; then
    echo "✗ database unreachable after ${DB_WAIT_SECONDS:-60}s" >&2
    exit 1
  fi
  sleep 2
done
log "database is up"

# ---------------------------------------------------------------------------
# schema
# ---------------------------------------------------------------------------
# The committed migrations are SQLite-flavoured (that is the repo's default
# provider) and will not replay against PostgreSQL, so `db push` is the primary
# path here. It is non-destructive: it creates what is missing and leaves
# existing data alone.
#
# If you generate real Postgres migrations later
# (`node scripts/set-db-provider.mjs postgresql && npx prisma migrate dev`),
# `migrate deploy` becomes the correct path and is tried first.
if [ -d prisma/migrations ] && npx prisma migrate deploy 2>/dev/null; then
  log "migrations applied"
else
  log "pushing the schema…"
  npx prisma db push --skip-generate
fi
log "schema is in sync"

# ---------------------------------------------------------------------------
# seed (opt-in, and only when there is nothing to overwrite)
# ---------------------------------------------------------------------------
if [ "$RUN_SEED" = "true" ]; then
  EMPTY=$(node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.listing.count()
  .then((n) => console.log(n === 0 ? 'yes' : 'no'))
  .catch(() => console.log('yes'))
  .finally(() => p.\$disconnect());
" 2>/dev/null || echo "no")

  if [ "$EMPTY" = "yes" ]; then
    log "database is empty — seeding…"
    npx tsx prisma/seed.ts
  else
    log "database already has listings — skipping the seed"
  fi
fi

log "done"
