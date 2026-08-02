-- ---------------------------------------------------------------------------
-- English name / description / area on Listing
-- ---------------------------------------------------------------------------
-- The bilingual release translated the interface and the editable site copy,
-- but a listing's own prose — its name, its description and its area line —
-- had nowhere to put an English version, so those three strings stayed Arabic
-- on the English site. These columns are the missing half.
--
-- Pure DDL, no backfill, deliberately. The columns are nullable with no
-- default because NULL already carries the meaning the application wants:
-- `localizeListing()` in src/lib/listings.ts reads a blank English value as
-- "use the Arabic one". Giving them `DEFAULT ''` would be the same thing with
-- extra table-rewrite cost, and giving them the Arabic text as a starting value
-- would be worse — an operator could never tell an untranslated listing from
-- one someone had deliberately left the same in both languages.
--
-- Safe to re-run against a database that already has them.
-- ---------------------------------------------------------------------------

ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "nameEn"        TEXT;
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "descriptionEn" TEXT;
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "areaEn"        TEXT;
