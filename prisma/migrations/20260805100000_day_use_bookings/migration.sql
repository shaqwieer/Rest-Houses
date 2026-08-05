-- ---------------------------------------------------------------------------
-- Day-use bookings (حجز بدون مبيت) become real reservations.
--
-- Day-use rates have existed on `Listing` since 20260803120000, but only as
-- published information — a guest read the price and arranged the day with the
-- owner on WhatsApp. This column is what makes one a booking the platform
-- records: `dayUse = true` means `checkIn === checkOut`, `nights = 0`, priced
-- from the listing's day rate, and occupying that one calendar day.
--
-- Additive and defaulted, so every existing row is what it has always been: an
-- overnight stay. Nothing to backfill and no data path that can fail.
-- ---------------------------------------------------------------------------

ALTER TABLE "BookingRequest" ADD COLUMN "dayUse" BOOLEAN NOT NULL DEFAULT false;

-- The owner's queue and the operator's lists already filter on status; this
-- makes "which day-use bookings are on the books" cheap for the same screens
-- without changing any of them.
CREATE INDEX "BookingRequest_dayUse_idx" ON "BookingRequest"("dayUse");
