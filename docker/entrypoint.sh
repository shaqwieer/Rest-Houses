#!/bin/sh
# ============================================================================
#  App container entrypoint
# ============================================================================
#  Deliberately minimal. Schema migration and seeding happen in the separate
#  one-shot `migrate` service (docker/migrate.sh), which compose runs to
#  completion before this container starts — see `depends_on:
#  service_completed_successfully` in docker-compose.yml.
#
#  Keeping them apart means the runtime image needs no Prisma CLI and no
#  TypeScript toolchain, and migrations can never race between replicas.
#
#  All this does is fail fast on misconfiguration, then hand over to the server
#  with `exec` so Node becomes PID 1 and receives SIGTERM directly (clean
#  shutdowns, no 10-second kill timeout on every deploy).
# ============================================================================
set -e

fail() { echo "✗ $*" >&2; exit 1; }

[ -n "$DATABASE_URL" ] || fail "DATABASE_URL is not set"

# Refuse to boot rather than start with a session-signing footgun: without a
# stable secret every restart silently invalidates logins, and a built-in default
# would be public knowledge.
[ -n "$AUTH_SECRET" ] || fail "AUTH_SECRET is not set — generate one with: openssl rand -base64 32"

echo "▸ starting the server on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec "$@"
