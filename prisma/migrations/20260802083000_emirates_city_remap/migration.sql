-- ---------------------------------------------------------------------------
-- City ids become the seven emirates
-- ---------------------------------------------------------------------------
-- `CITIES` in src/lib/constants.ts previously mixed emirates with regions
-- inside them: "العين" and "الظفرة وليوا" are both part of Abu Dhabi, so a
-- visitor filtering by أبوظبي never saw them. The list is now the seven
-- emirates; town-level detail already lives in `Listing.area`, which holds
-- strings like "لهباب – دبي" and "العين – الهيلي", so nothing is lost.
--
-- A DATA migration, not schema: `city` is a String column, so the retired ids
-- are ordinary values that have to be rewritten. This is exactly the kind of
-- statement `prisma db push` ignores — it diffs the schema and emits DDL only —
-- which is why the deploy path no longer falls back to it.
--
-- Idempotent: re-running matches nothing the second time. Safe on an empty
-- database (a fresh install has no rows to remap) and safe on an existing one.
-- ---------------------------------------------------------------------------

UPDATE "Listing"      SET "city" = 'abudhabi' WHERE "city" IN ('alain', 'liwa');
UPDATE "OwnerProfile" SET "city" = 'abudhabi' WHERE "city" IN ('alain', 'liwa');
