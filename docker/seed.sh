#!/bin/sh
# ============================================================================
#  Sample-data seed — EXPLICIT, never part of a normal deploy
# ============================================================================
#  Run it deliberately:
#
#      docker compose --profile seed run --rm seed
#
#  ─── Why this is no longer part of migrate.sh ───────────────────────────────
#  Applying a schema and inserting sample data are different operations with
#  very different risk. Migrating is something every deploy must do; seeding is
#  something exactly one deploy should ever do. Running them from one script
#  behind one `RUN_SEED` flag meant a variable left at `true` in .env would try
#  to seed on *every* `docker compose up` — and the only thing standing between
#  that and eight demo استراحات reappearing on a live site was a row count.
#
#  So seeding now lives behind a compose profile: it does not run unless it is
#  named on the command line. `RUN_SEED` is gone.
#
#  ─── The guard is still here, and still matters ─────────────────────────────
#  prisma/seed.ts creates the admin account *and* the sample listings together —
#  there is no way to get one without the other. The count check below means a
#  second invocation on a populated database is a no-op rather than a duplicate
#  catalogue, so running this by accident is recoverable.
#
#  To create only an admin on a fresh install, seed once and then delete the
#  sample listings from /admin. There is no separate admin-only path.
# ============================================================================
set -eu

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

# The schema must already exist — seeding is not a substitute for migrating.
EMPTY=$(node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.listing.count()
  .then((n) => console.log(n === 0 ? 'yes' : 'no'))
  .catch(() => console.log('error'))
  .finally(() => p.\$disconnect());
" 2>/dev/null || echo "error")

case "$EMPTY" in
  error)
    echo "✗ could not read the Listing table." >&2
    echo "  Has the schema been applied? Run the migrate service first." >&2
    exit 1
    ;;
  no)
    log "listings already exist — skipping the seed (this is not an error)"
    exit 0
    ;;
esac

log "database is empty — seeding sample data…"
npx tsx prisma/seed.ts
log "done"
