#!/usr/bin/env node
/**
 * Rewrite the `provider` line in prisma/schema.prisma.
 *
 *   node scripts/set-db-provider.mjs postgresql
 *   node scripts/set-db-provider.mjs sqlite
 *
 * Why this exists: Prisma's datasource `provider` cannot be set from an
 * environment variable, but this project has to run on SQLite (zero-setup local
 * dev) and PostgreSQL (Docker / production) from ONE schema. The alternative —
 * committing two schema files — guarantees they drift apart the first time
 * someone adds a field.
 *
 * The Docker build calls this before `prisma generate`, so the image ships a
 * client compiled for Postgres while the repo keeps SQLite as its default.
 *
 * Safe to run repeatedly; a no-op when the provider already matches.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SUPPORTED = ["sqlite", "postgresql"];

const target = process.argv[2];
if (!SUPPORTED.includes(target)) {
  console.error(
    `usage: node scripts/set-db-provider.mjs <${SUPPORTED.join("|")}>\n` +
      `  got: ${target ?? "(nothing)"}`,
  );
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "prisma", "schema.prisma");

const schema = readFileSync(schemaPath, "utf8");

/**
 * Anchor the block match to the start of a line (`^` with the `m` flag).
 *
 * Without that anchor this also matches the illustrative
 * `//   datasource db { provider = "postgresql" ... }` inside the schema's header
 * comment — and rewriting a comment while leaving the real block untouched is a
 * silent no-op that only shows up later as "why is it still SQLite?".
 * The generator block is never matched because the keyword must be `datasource`.
 */
const blockRe = /^datasource\s+\w+\s*\{[\s\S]*?^\}/m;
const block = schema.match(blockRe);

if (!block) {
  console.error("✗ could not find a datasource block in prisma/schema.prisma");
  process.exit(1);
}

const providerRe = /(provider\s*=\s*")([^"]+)(")/;
const provider = block[0].match(providerRe);

if (!provider) {
  console.error("✗ the datasource block has no provider line");
  process.exit(1);
}

const current = provider[2];
if (current === target) {
  console.log(`✓ datasource provider is already "${target}"`);
  process.exit(0);
}

const updatedBlock = block[0].replace(providerRe, `$1${target}$3`);
writeFileSync(schemaPath, schema.replace(blockRe, updatedBlock), "utf8");
console.log(`✓ datasource provider: "${current}" → "${target}"`);

if (target === "postgresql") {
  console.log(
    "  note: SQLite migrations are not PostgreSQL-compatible. Against a fresh\n" +
      "  Postgres database run `prisma migrate deploy` if you generated Postgres\n" +
      "  migrations, or `prisma db push` to apply the schema directly.",
  );
}
