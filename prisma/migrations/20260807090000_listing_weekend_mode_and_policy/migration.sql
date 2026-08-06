-- ---------------------------------------------------------------------------
-- A rest house's own weekend, and its own stay policy.
--
-- ─── weekendMode ───────────────────────────────────────────────────────────
-- `weekendPrice` has always existed; which DAYS it applied to was hard-coded.
-- It cannot be: Sharjah works a four-day week, so Friday is a day off there and
-- a Sharjah rest house is full on Friday night while a Dubai one is not.
--
--   'short' — Saturday + Sunday.            The UAE weekend.
--   'long'  — Friday + Saturday + Sunday.   Sharjah's.
--
-- ─── checkInTime / checkOutTime / freeCancelHours ──────────────────────────
-- These three lived only on `SiteSettings`, which made them one platform-wide
-- answer printed on every listing page. Each rest house has its own: one owner
-- hands over the keys at 3pm, another at 5pm, and a guest told the wrong hour
-- arrives at a locked gate.
--
-- The `SiteSettings` columns STAY and keep their meaning — they are now the
-- fallback rather than the answer. A blank time or a NULL `freeCancelHours` on
-- a listing means "use the platform's", which is what every existing row gets.
--
-- NULL vs 0 on `freeCancelHours` is load-bearing and deliberately not
-- defaulted: NULL = "use the platform's window", 0 = "I allow no free
-- cancellation". Defaulting the column to 0 would publish every owner on the
-- platform as refusing free cancellation overnight.
--
-- Every column here is additive with a default (or nullable), so this migration
-- has nothing to backfill and no data path that can fail.
--
-- ─── The one behaviour change, stated plainly ──────────────────────────────
-- Existing rows all take 'short' = Saturday + Sunday. The code they are moving
-- from charged the weekend rate on Friday + Saturday. So on every listing that
-- does not opt into the long weekend, Friday nights move to the weekday rate
-- and Sunday nights move to the weekend rate. That is the correction that was
-- asked for — the UAE weekend moved to Sat/Sun in 2022 and the old constant had
-- not — but it changes prices on rows nobody edited, which is why it is written
-- down here. Owners who want Friday back at the weekend rate choose 'long'.
-- ---------------------------------------------------------------------------

ALTER TABLE "Listing" ADD COLUMN "weekendMode" TEXT NOT NULL DEFAULT 'short';

ALTER TABLE "Listing" ADD COLUMN "checkInTime" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Listing" ADD COLUMN "checkInTimeEn" TEXT;
ALTER TABLE "Listing" ADD COLUMN "checkOutTime" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Listing" ADD COLUMN "checkOutTimeEn" TEXT;
ALTER TABLE "Listing" ADD COLUMN "freeCancelHours" INTEGER;
