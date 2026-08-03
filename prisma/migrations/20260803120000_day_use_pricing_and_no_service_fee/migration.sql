-- ---------------------------------------------------------------------------
-- Day-use pricing, refundable security deposit, and the end of the service fee
-- ---------------------------------------------------------------------------
-- Three related commercial changes, one migration, because they ship together
-- and a database that has one without the others is a state no code path
-- expects.
--
-- ─── 1. Day-use pricing on Listing ─────────────────────────────────────────
-- Rates for a booking with no overnight stay, weekday and weekend, plus the
-- hour the guest has to be out by. Informational only — see the note on
-- `dayUsePrice` in schema.prisma for why a same-day stay is not bookable
-- through the calendar.
--
-- 0 is the "not offered" value and hides the whole block, so every existing
-- listing keeps exactly the page it has today. That is why these carry
-- DEFAULT 0 rather than being nullable: unlike `depositPercent`, there is no
-- "inherit the platform's figure" case to distinguish from "none".
--
-- `dayUseCheckOutTimeEn` is nullable with no default, matching `nameEn` and
-- `areaEn`: NULL already means "show the Arabic text to English readers".
--
-- ─── 2. Refundable security deposit ────────────────────────────────────────
-- On Listing (what the owner asks for) and on BookingRequest (the snapshot
-- taken when the request was made). Both DEFAULT 0.
--
-- The BookingRequest column is what the confirmation page and the WhatsApp
-- message read. Existing rows get 0 and are NOT backfilled from their listing:
-- a request made before the owner published a security deposit did not quote
-- one, and rewriting history to say it did would be a lie told by a migration.
--
-- ─── 3. serviceFeePercent → 0 ──────────────────────────────────────────────
-- The platform no longer adds a separate service fee; the total is the price
-- shown. The column stays so the arithmetic keeps a home and an operator can
-- switch a fee back on from /admin/settings.
--
-- BOTH statements are needed, and this is the trap this project has been bitten
-- by before: `ALTER COLUMN … SET DEFAULT` changes what *future* rows get and
-- touches no existing row. The settings table has exactly one row, already
-- carrying 5, and without the UPDATE the live site would keep charging 5%
-- while the schema claimed 0.
--
-- `BookingRequest.serviceFee` is deliberately left alone. Those are price
-- snapshots: a booking that was quoted at 5% was quoted at 5%, and its receipt
-- must keep saying so.
--
-- Idempotent throughout — safe to re-run, and safe on an empty database.
-- ---------------------------------------------------------------------------

-- 1 + 2 — new listing columns
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "dayUsePrice"          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "dayUseWeekendPrice"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "dayUseCheckOutTime"   TEXT    NOT NULL DEFAULT '';
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "dayUseCheckOutTimeEn" TEXT;
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "securityDeposit"      INTEGER NOT NULL DEFAULT 0;

-- 2 — the booking-time snapshot
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "securityDeposit" INTEGER NOT NULL DEFAULT 0;

-- 3 — no service fee, for new installs and for the row that already exists
ALTER TABLE "SiteSettings" ALTER COLUMN "serviceFeePercent" SET DEFAULT 0;
UPDATE "SiteSettings" SET "serviceFeePercent" = 0 WHERE "serviceFeePercent" <> 0;
