-- ---------------------------------------------------------------------------
-- Holiday pricing, and a per-owner commission rate.
--
-- Three additions, no data movement and nothing dropped. Every existing row
-- keeps behaving exactly as it does today, which is the property that made all
-- three safe to ship together:
--
--   Listing.holidayPrice = 0        -> "no special rate", so pricing falls
--                                      through to the existing weekend/weekday
--                                      rules. Nothing repriced on release.
--   OwnerProfile.commissionPercent  -> NULL = "no special deal, use the
--                                      platform rate". Deliberately nullable
--                                      rather than defaulted to 5: NULL and 0
--                                      mean different things (see the model),
--                                      and backfilling the current platform
--                                      rate would freeze today's number onto
--                                      every owner, so changing the platform
--                                      setting later would move nobody.
--   SpecialDay                      -> a new, empty table.
--
-- Note what is NOT here: a seeded list of public holidays. Eid moves with the
-- Hijri year and is fixed by moon sighting days ahead, so any table shipped in
-- a migration is wrong the following year. Owners mark the days themselves.
--
-- Existing bookings are untouched by the commission column: every
-- BookingRequest already snapshots `commissionPercent` at request time, so what
-- an owner owes on a past booking cannot be rewritten by a later rate change.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "holidayPrice" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OwnerProfile" ADD COLUMN     "commissionPercent" INTEGER;

-- CreateTable
CREATE TABLE "SpecialDay" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpecialDay_listingId_date_idx" ON "SpecialDay"("listingId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialDay_listingId_date_key" ON "SpecialDay"("listingId", "date");

-- AddForeignKey
ALTER TABLE "SpecialDay" ADD CONSTRAINT "SpecialDay_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

