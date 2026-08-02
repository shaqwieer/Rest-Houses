import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

/**
 * Builds the test database **once**, before any test file runs.
 *
 * This has to be a `globalSetup` rather than something each test file calls:
 * Vitest isolates module state per test file, so a module-level "already done"
 * flag resets for every file, and the second file would try to delete a SQLite
 * database the first one still has open — EBUSY on Windows.
 *
 * `globalSetup` runs in its own process before the workers start, so the file
 * is created exactly once and no worker is holding it at that moment.
 */
export default function setup() {
  const root = path.resolve(__dirname, "..");

  // Delete rather than `--force-reset`: same outcome on a throwaway file, but
  // `--force-reset` is a guarded destructive operation that prompts for
  // confirmation and would hang an unattended run. This path is `test.db`,
  // never `dev.db`.
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(path.join(root, "prisma", `test.db${suffix}`), { force: true });
  }

  // `db push` builds the schema straight from schema.prisma, so the test
  // database matches the current schema even mid-change and does not need the
  // migration history to replay.
  //
  // `execSync` (which goes via a shell) rather than `execFileSync`: on Windows
  // `npx` is a .cmd shim and Node 20+ refuses to spawn one directly.
  execSync("npx prisma db push --skip-generate", {
    cwd: root,
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "pipe",
  });
}
