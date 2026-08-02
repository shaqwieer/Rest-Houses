#!/bin/sh
# ============================================================================
#  Schema migration job — runs once per `docker compose up`, before the app
# ============================================================================
#  Executed by the `migrate` compose service, built from the `build` stage
#  (which still has the full node_modules, so the Prisma CLI is available).
#
#  Why a separate service rather than part of the app's entrypoint:
#    • the runtime image stays minimal — no Prisma CLI, no TypeScript toolchain
#    • migrations run exactly once. If every app replica applied the schema on
#      boot, scaling to two would have them racing each other.
#
#  `app` declares `depends_on: migrate: condition: service_completed_successfully`,
#  so a non-zero exit here means the application never starts. That is the
#  intended behaviour: serving traffic against a half-migrated database is worse
#  than being down, because it corrupts data instead of just refusing requests.
#
#  ─── This script deliberately has NO fallback ───────────────────────────────
#  It used to be:
#
#      if npx prisma migrate deploy 2>/dev/null; then … else npx prisma db push; fi
#
#  which was wrong in three separate ways:
#    1. `2>/dev/null` discarded the actual error, so nobody ever learned why
#       `migrate deploy` had failed.
#    2. `db push` diffs schema.prisma against the live database and emits DDL
#       only — it never reads migration SQL. Every data migration (an UPDATE
#       backfilling a new column, a value remap) was silently skipped.
#    3. It then printed "🚀 Your database is now in sync with your Prisma
#       schema" and exited 0, so a deploy that had quietly dropped half a
#       release reported success.
#
#  That combination shipped a release to production whose city-id remap never
#  ran, leaving rows pointing at ids the application no longer recognised. The
#  schema looked right, the data was wrong, and the log said everything was fine.
#
#  There is no environment in which silently diverging from migration history is
#  the desired outcome, so the fallback is gone rather than gated behind an
#  environment check. If `migrate deploy` fails, the deploy fails — loudly, with
#  the real error on stdout.
#
#  Seeding is NOT part of this script — see docker/seed.sh. Applying a schema and
#  inserting sample data are different operations with different risk, and
#  conflating them is how RUN_SEED ends up resurrecting demo listings on a live
#  site.
# ============================================================================
set -eu

log() { echo "▸ $*"; }
fail() { echo "✗ $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# wait for the database
# ---------------------------------------------------------------------------
log "waiting for the database…"
i=0
until node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$queryRaw\`SELECT 1\`.then(() => process.exit(0)).catch(() => process.exit(1)).finally(() => p.\$disconnect());
" >/dev/null 2>&1; do
  i=$((i + 2))
  if [ "$i" -ge "${DB_WAIT_SECONDS:-60}" ]; then
    fail "database unreachable after ${DB_WAIT_SECONDS:-60}s"
  fi
  sleep 2
done
log "database is up"

# ---------------------------------------------------------------------------
# apply migrations — the only path
# ---------------------------------------------------------------------------
[ -d prisma/migrations ] || fail "prisma/migrations is missing from the image"

log "applying migrations…"

# No redirection: Prisma's own error output is the most useful diagnostic there
# is when this fails, and hiding it was the original defect.
#
# `set -e` would already abort here; the explicit branch exists to add the
# context that turns a stack trace into an instruction.
if ! npx prisma migrate deploy; then
  echo "" >&2
  echo "✗ migration failed — the application will NOT be started." >&2
  echo "" >&2
  echo "  Each migration runs in its own transaction, so the database is left" >&2
  echo "  as it was rather than half-applied." >&2
  echo "" >&2
  echo "  Common causes:" >&2
  echo "    • the database was previously set up with 'prisma db push', so it" >&2
  echo "      has the tables but no migration history. Baseline it once:" >&2
  echo "          npx prisma migrate resolve --applied <first_migration_name>" >&2
  echo "    • a migration is genuinely invalid — read the error above." >&2
  echo "" >&2
  echo "  Inspect with:  npx prisma migrate status" >&2
  exit 1
fi

log "migrations applied"

# ---------------------------------------------------------------------------
# report where we ended up
# ---------------------------------------------------------------------------
# `migrate status` exits non-zero when anything is pending or failed, which
# would abort under `set -e`. Deploy has already succeeded above, so this is
# purely informational — hence the `|| true`.
npx prisma migrate status 2>&1 | sed 's/^/  /' || true

log "done"
