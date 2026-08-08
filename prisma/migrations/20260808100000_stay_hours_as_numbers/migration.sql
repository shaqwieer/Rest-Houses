-- ---------------------------------------------------------------------------
-- Arrival, departure and day-use leave-by times become numbers.
--
-- Five new nullable integer columns. Nothing is dropped and nothing is
-- rewritten, and both of those are deliberate.
--
-- ─── Why the old text columns stay ------------------------------------------
-- The five columns this replaces hold whatever an owner typed: "٤ عصرًا",
-- "بعد العصر", "4pm", "". Only a handful of those parse into an hour with any
-- confidence. The tempting migration parses what it can and nulls the rest —
-- and that is a truthfulness regression, not a neutral default. An owner who
-- typed "٣ عصرًا" means three o'clock, which is genuinely NOT the platform's
-- four; nulling that row makes the listing page start advertising 4 PM for a
-- rest house whose gate opens at 3. `resolveStayTimes` was written to avoid
-- exactly that, and a migration must not reintroduce it through the back door.
--
-- So the old text becomes the MIDDLE tier of the fallback instead:
--
--     hour is set        -> formatHour(hour, locale)        (the new answer)
--     else text is set   -> the text, as it renders today   (unchanged row)
--     else               -> the platform's hour             (as before)
--
-- A row nobody touches renders byte-identically to how it renders now. The
-- text columns are emptied one at a time, by owners picking an hour in the
-- editor, and `npm run policy-audit` lists whoever is left.
--
-- ─── Why the backfill is only four strings ----------------------------------
-- The exact platform defaults are the only values that can be converted
-- without guessing: they were written by this codebase, not by a person. Every
-- other string is somebody's own words and is left for them to confirm.
--
-- ─── Why nullable, with no DEFAULT ------------------------------------------
-- `checkInHour INTEGER NOT NULL DEFAULT 16` would stamp four o'clock onto every
-- settings row on deploy, including an operator whose stored text says five.
-- The column has to be able to say "nobody has answered yet", which is what
-- NULL is for. Same rule as `Listing.freeCancelHours` and `depositPercent`.
-- ---------------------------------------------------------------------------

ALTER TABLE "Listing" ADD COLUMN "checkInHour" INTEGER;
ALTER TABLE "Listing" ADD COLUMN "checkOutHour" INTEGER;
ALTER TABLE "Listing" ADD COLUMN "dayUseCheckOutHour" INTEGER;

ALTER TABLE "SiteSettings" ADD COLUMN "checkInHour" INTEGER;
ALTER TABLE "SiteSettings" ADD COLUMN "checkOutHour" INTEGER;

-- The four machine-written defaults, and only those. `TRIM` because the save
-- action trims on write but rows predating it may not have been.
UPDATE "SiteSettings"
   SET "checkInHour" = 16
 WHERE "checkInHour" IS NULL
   AND TRIM("checkInTime") IN ('٤ عصرًا', '4 PM');

UPDATE "SiteSettings"
   SET "checkOutHour" = 12
 WHERE "checkOutHour" IS NULL
   AND TRIM("checkOutTime") IN ('١٢ ظهرًا', '12 noon');

UPDATE "Listing"
   SET "checkInHour" = 16
 WHERE "checkInHour" IS NULL
   AND TRIM("checkInTime") IN ('٤ عصرًا', '4 PM');

UPDATE "Listing"
   SET "checkOutHour" = 12
 WHERE "checkOutHour" IS NULL
   AND TRIM("checkOutTime") IN ('١٢ ظهرًا', '12 noon');
