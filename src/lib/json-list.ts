/**
 * Read/write the JSON-text columns (`Listing.amenities`, `Listing.categories`).
 *
 * Why text and not a Postgres `String[]`: this predates the move to
 * PostgreSQL-only, when the schema also had to run on SQLite, which has no
 * scalar lists. Changing it now would mean migrating live rows for no
 * functional gain. The cost is documented at the top of prisma/schema.prisma
 * and in `filterByAmenities` in src/lib/listings.ts.
 */

/** Parse a stored JSON array of ids. Corrupt or legacy values yield []. */
export function parseIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

/** Serialise for storage: de-duplicated, order preserved. */
export function stringifyIdList(ids: readonly string[]): string {
  return JSON.stringify([...new Set(ids)]);
}
