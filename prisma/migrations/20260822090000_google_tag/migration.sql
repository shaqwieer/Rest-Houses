-- ---------------------------------------------------------------------------
-- Google tag — two identifier columns on the settings row.
--
-- Pure DDL. Two TEXT columns, NOT NULL DEFAULT '', no data movement, nothing
-- dropped, no index (nothing ever filters on them; they are read once per
-- render alongside the rest of the row).
--
-- ─── Why '' is the right backfill ──────────────────────────────────────────
-- '' means "no Google tag configured", and that is true of every existing row
-- by construction: until this release the site rendered no tracking script at
-- all. `<GoogleTag>` returns null on an empty id, so a database that migrates
-- and is never touched again serves exactly the HTML it served yesterday.
--
-- This is deliberately the opposite of the defaulted-copy trap this repo has
-- been bitten by, where a schema default written for the sample brand landed on
-- a live site's settings row. A plausible-looking default here would be far
-- worse than wrong wording: it would start reporting a real site's traffic and
-- bookings into somebody else's Google Ads account.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "googleTagId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "googleAdsConversionLabel" TEXT NOT NULL DEFAULT '';
