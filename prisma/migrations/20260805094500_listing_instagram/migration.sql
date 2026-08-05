-- ---------------------------------------------------------------------------
-- A rest house's own Instagram profile, shown as an icon on its detail page.
--
-- Nullable with no default and nothing to backfill: NULL means "this owner has
-- not given one", which is what every existing row means, and the detail page
-- renders no icon for it. Pure DDL, so there is no data path that can fail.
-- ---------------------------------------------------------------------------

ALTER TABLE "Listing" ADD COLUMN "instagram" TEXT;
