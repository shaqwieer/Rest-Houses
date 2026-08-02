/**
 * Test bootstrap.
 *
 * Points `DATABASE_URL` at a throwaway SQLite file **before** anything imports
 * the Prisma client, so no test can touch the development database. The
 * assignment has to happen in a setup file rather than a test file because
 * `src/lib/prisma.ts` reads the variable at import time, and Vitest evaluates
 * setup files first.
 *
 * The schema is pushed into that file once per run by `tests/db.ts`.
 */

process.env.DATABASE_URL = "file:./test.db";

// NextAuth refuses to start without a secret. Any value works here — nothing in
// the suite verifies a real session token.
process.env.AUTH_SECRET ??= "test-secret-not-used-for-anything-real";
process.env.NEXTAUTH_URL ??= "http://localhost:3000";
process.env.NEXT_PUBLIC_SITE_URL ??= "http://localhost:3000";
