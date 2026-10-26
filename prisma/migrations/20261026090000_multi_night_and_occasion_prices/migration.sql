-- A lower nightly rate for stays of two nights or more, and an occasion rate
-- of a day's own («رأس السنة» at 8,000 on a listing whose occasion rate is 5,000).
--
-- Additive only, and nothing reprices on release:
--
--   Listing.multiNightPrice / multiNightWeekendPrice = 0 -> "not offered", so
--                                    every stay prices by the existing ladder.
--   SpecialDay.price = NULL          -> "use the listing's holidayPrice", which
--                                    is exactly what every marked day charges
--                                    today, public-holiday copies included.
--
-- Existing bookings are untouched: each one stores its own subtotal and total.

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "multiNightPrice" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "multiNightWeekendPrice" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SpecialDay" ADD COLUMN     "price" INTEGER;
