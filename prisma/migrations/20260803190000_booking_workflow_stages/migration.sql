-- ---------------------------------------------------------------------------
-- The booking handover workflow — seven steps, plus the review invite
-- ---------------------------------------------------------------------------
-- Confirming a booking used to be a single button. It is now a sequence the
-- owner walks: take the deposit and the security deposit, take the balance on
-- arrival, check the guest out, inspect the rest house, return the security
-- deposit less any damages, remit the platform's commission, and finally invite
-- the guest to review the stay.
--
-- ─── `stage` is a NEW column, not new values in `status` ────────────────────
-- `BookingRequest.status` stays exactly as it was — "NEW" | "CONFIRMED" |
-- "REJECTED" | "CANCELLED" — because it is what closes the calendar and what
-- every filter chip, badge and public page in the application keys off. The
-- seven steps only exist inside the CONFIRMED state, so they get their own
-- orthogonal column. See the note on `stage` in schema.prisma.
--
-- ─── The backfill is the part that cannot be left to a DEFAULT ──────────────
-- This project has been bitten before by a migration that added a column with a
-- default and assumed existing rows were therefore correct. They are not:
-- `stage DEFAULT 'DEPOSIT'` would put every already-confirmed booking back at
-- step 1, telling owners to collect a deposit they took weeks ago.
--
-- So a CONFIRMED row is moved to step 2 explicitly, and its
-- `depositConfirmedAt` is set from `updatedAt` — the moment the confirmation
-- was actually recorded, which is the closest true value that exists.
--
-- It is moved to step 2 and NO further, deliberately, including for stays whose
-- checkout date has long passed. Steps 3 to 6 assert that money changed hands
-- and that somebody inspected the property; a migration cannot know either, and
-- writing "security deposit returned" because a date is in the past would be
-- the database telling a lie on the owner's behalf. Walking an old booking
-- through the remaining steps is a few taps, and every one of them is true.
--
-- NEW / REJECTED / CANCELLED rows keep the 'DEPOSIT' default: for them the
-- workflow has not started, which is precisely what step 1 means.
--
-- ─── Commission ────────────────────────────────────────────────────────────
-- `commissionDue` is backfilled per row rather than by one formula, because the
-- platform's cut reached it two different ways:
--   * rows with serviceFee > 0 predate the fee being switched off. The guest
--     was charged that fee ON TOP of the nights and it IS the platform's cut —
--     charging 5% again would bill the same money twice.
--   * rows with serviceFee = 0 were quoted the advertised price with the
--     commission already inside it, so it has to be derived: 5% of the total.
--
-- Re-run semantics, stated plainly: the DDL is idempotent (IF NOT EXISTS), the
-- backfills are not fully so — re-running the UPDATEs would overwrite a stage
-- an owner has since advanced. `prisma migrate deploy` applies a migration once
-- and records it, so this runs exactly once; the guards below exist to keep a
-- half-applied migration recoverable, not to invite a replay.
-- ---------------------------------------------------------------------------

-- --- SiteSettings: the commission, and the review-link lifetime -------------
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "commissionPercent" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "SiteSettings" ADD COLUMN IF NOT EXISTS "reviewInviteDays"  INTEGER NOT NULL DEFAULT 15;

-- --- BookingRequest: the commission snapshot --------------------------------
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "commissionPercent" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "commissionDue"     INTEGER NOT NULL DEFAULT 0;

-- --- BookingRequest: the workflow -------------------------------------------
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "stage" TEXT NOT NULL DEFAULT 'DEPOSIT';

-- Nullable throughout: NULL is "this step has not happened", which a 0 could
-- not express — a returned-in-full security deposit has a damage deduction of
-- exactly 0 and that is a completed step.
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "depositCollected"  INTEGER;
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "securityCollected" INTEGER;
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "balanceCollected"  INTEGER;
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "damageDeduction"   INTEGER;
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "securityReturned"  INTEGER;
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "inspectionNotes"   TEXT;
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "commissionReference" TEXT;

ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "depositConfirmedAt"    TIMESTAMP(3);
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "balancePaidAt"         TIMESTAMP(3);
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "checkedOutAt"          TIMESTAMP(3);
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "inspectedAt"           TIMESTAMP(3);
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "securityReturnedAt"    TIMESTAMP(3);
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "commissionSentAt"      TIMESTAMP(3);
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "commissionConfirmedAt" TIMESTAMP(3);
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "reviewInvitedAt"       TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "BookingRequest_status_stage_idx" ON "BookingRequest"("status", "stage");

-- --- Backfill: the commission owed on every existing booking ----------------
UPDATE "BookingRequest"
   SET "commissionDue" = CASE
         WHEN "serviceFee" > 0 THEN "serviceFee"
         ELSE ROUND("total" * 5.0 / 100)
       END
 WHERE "commissionDue" = 0;

-- --- Backfill: already-confirmed bookings start at step 2, not step 1 -------
UPDATE "BookingRequest"
   SET "stage" = 'BALANCE',
       "depositConfirmedAt" = "updatedAt"
 WHERE "status" = 'CONFIRMED'
   AND "depositConfirmedAt" IS NULL;

-- --- Review moderation ------------------------------------------------------
-- 'APPROVED', not 'PENDING': every existing review is already published, and a
-- default that contradicted the column beside it would hide the seeded
-- catalogue's reviews the moment this ran.
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "status"    TEXT NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "bookingId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Review_bookingId_key" ON "Review"("bookingId");
CREATE INDEX IF NOT EXISTS "Review_status_idx" ON "Review"("status");

DO $$
BEGIN
  ALTER TABLE "Review"
    ADD CONSTRAINT "Review_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "BookingRequest"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- --- ReviewInvite -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ReviewInvite" (
    "id"        TEXT NOT NULL,
    "token"     TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReviewInvite_token_key"     ON "ReviewInvite"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "ReviewInvite_bookingId_key" ON "ReviewInvite"("bookingId");
CREATE INDEX        IF NOT EXISTS "ReviewInvite_listingId_idx" ON "ReviewInvite"("listingId");

DO $$
BEGIN
  ALTER TABLE "ReviewInvite"
    ADD CONSTRAINT "ReviewInvite_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "BookingRequest"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ReviewInvite"
    ADD CONSTRAINT "ReviewInvite_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
