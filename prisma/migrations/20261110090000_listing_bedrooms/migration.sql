-- How many bedrooms a rest house has, shown on its card and its page.
--
-- Additive only: 0 means "not stated" and renders nothing, so every existing
-- listing looks exactly as it did until its owner fills the number in.

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "bedrooms" INTEGER NOT NULL DEFAULT 0;
