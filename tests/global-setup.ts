import { execSync } from "node:child_process";
import path from "node:path";
import { Client } from "pg";

/**
 * Builds the test database **once**, before any test file runs.
 *
 * This has to be a `globalSetup` rather than something each test file calls:
 * Vitest isolates module state per test file, so an "already done" flag resets
 * for every file and the work would be repeated — and two workers racing to
 * drop and recreate the same database is a flake generator.
 *
 * ─── Migrations, not `db push` ───────────────────────────────────────────────
 * The schema is applied with `prisma migrate deploy`, the same command
 * production runs. `db push` would be faster, but it only emits DDL — it never
 * reads migration SQL — so a broken *data* migration would sail through the
 * entire suite and fail on the live database instead. Running the real
 * migrations here is what makes a green suite evidence that a deploy will work.
 */

const HOST = process.env.TEST_DB_HOST ?? "127.0.0.1";
const PORT = process.env.TEST_DB_PORT ?? "55433";
const USER = process.env.TEST_DB_USER ?? "chalets";
const PASS = process.env.TEST_DB_PASSWORD ?? "chalets";
const DB_NAME = process.env.TEST_DB_NAME ?? "desert_chalets_test";

const ADMIN_URL = `postgresql://${USER}:${PASS}@${HOST}:${PORT}/postgres`;
const TEST_URL = `postgresql://${USER}:${PASS}@${HOST}:${PORT}/${DB_NAME}?schema=public`;

export default async function setup() {
  const root = path.resolve(__dirname, "..");

  let admin: Client;
  try {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
  } catch (cause) {
    // The single most likely failure, and an opaque one if left as a raw
    // ECONNREFUSED — so say what to run.
    throw new Error(
      `Cannot reach PostgreSQL at ${HOST}:${PORT}.\n\n` +
        `The test suite runs against the same engine as production.\n` +
        `Start it with:\n\n    npm run db:up\n\n` +
        `(then re-run the tests)`,
      { cause },
    );
  }

  try {
    // Dropped and recreated per run, so a schema change mid-development can
    // never leave a stale column behind to confuse the next run.
    //
    // FORCE terminates any lingering connection from a killed previous run;
    // without it DROP DATABASE fails with "is being accessed by other users".
    await admin.query(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${DB_NAME}"`);
  } finally {
    await admin.end();
  }

  // `execSync` (which goes through a shell) rather than `execFileSync`: on
  // Windows `npx` is a .cmd shim and Node 20+ refuses to spawn one directly.
  execSync("npx prisma migrate deploy", {
    cwd: root,
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: "pipe",
  });
}
