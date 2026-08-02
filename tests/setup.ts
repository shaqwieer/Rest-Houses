/**
 * Test bootstrap.
 *
 * Points `DATABASE_URL` at a throwaway PostgreSQL database **before** anything
 * imports the Prisma client — `src/lib/prisma.ts` reads the variable at import
 * time, and Vitest evaluates setup files first.
 *
 * ─── Why Postgres and not SQLite ─────────────────────────────────────────────
 * The suite used to run on SQLite because that was the repo's default provider.
 * Convenient, and precisely the reason a set of SQLite-flavoured migrations got
 * committed and then could never replay against production. Tests that pass on
 * a different engine than production do not tell you production works.
 *
 * The server comes from docker-compose.dev.yml (`npm run db:up`). The database
 * name differs from development's, so running the suite never touches whatever
 * you were working on.
 */

const HOST = process.env.TEST_DB_HOST ?? "127.0.0.1";
const PORT = process.env.TEST_DB_PORT ?? "55433";
const USER = process.env.TEST_DB_USER ?? "chalets";
const PASS = process.env.TEST_DB_PASSWORD ?? "chalets";

export const TEST_DB_NAME = process.env.TEST_DB_NAME ?? "desert_chalets_test";

/** Connection string for the test database itself. */
export const TEST_DATABASE_URL = `postgresql://${USER}:${PASS}@${HOST}:${PORT}/${TEST_DB_NAME}?schema=public`;

/** Connection to the maintenance database, for CREATE/DROP DATABASE. */
export const ADMIN_DATABASE_URL = `postgresql://${USER}:${PASS}@${HOST}:${PORT}/postgres?schema=public`;

process.env.DATABASE_URL = TEST_DATABASE_URL;

// NextAuth refuses to start without a secret. Any value works — nothing in the
// suite verifies a real session token.
process.env.AUTH_SECRET ??= "test-secret-not-used-for-anything-real";
process.env.NEXTAUTH_URL ??= "http://localhost:3000";
process.env.NEXT_PUBLIC_SITE_URL ??= "http://localhost:3000";
