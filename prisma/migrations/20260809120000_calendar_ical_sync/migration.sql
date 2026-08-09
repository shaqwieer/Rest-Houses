-- ---------------------------------------------------------------------------
-- Two-way iCal calendar sync with Airbnb and Booking.com.
--
-- Three things happen here. Two are pure additions; the third replaces a unique
-- index and is the only part that deserves reading twice.
--
-- ─── 1. CalendarFeed (new table) --------------------------------------------
-- One row per external calendar a listing imports from. Nothing reads it until
-- an owner pastes a URL, so existing listings are unaffected.
--
-- ─── 2. Listing.calendarToken (new nullable column) --------------------------
-- The secret in the listing's public .ics export URL. Deliberately NOT
-- backfilled: null means "export not enabled", which is the correct and safe
-- state for every listing that predates this. Generating one for every row
-- would silently publish a calendar feed for rest houses nobody asked to
-- publish, and doing it in SQL would mean seeding it from `random()`, which is
-- not a cryptographic source — this token is the entire authentication on a
-- public URL. It is minted by `crypto.randomBytes` in the application when an
-- owner turns export on.
--
-- ─── 3. Availability: the unique key gains a third column --------------------
--     was  @@unique([listingId, date])
--     now  @@unique([listingId, date, sourceKey])
--
-- The rewrite is safe and needs no backfill step, because of the order these
-- statements run in: `sourceKey` is added NOT NULL DEFAULT 'LOCAL', so every
-- existing row already carries 'LOCAL' by the time the new index is built. The
-- new index is therefore satisfied at exactly the same rows the old one was —
-- one row per (listing, day) whose sourceKey is 'LOCAL' — and no existing pair
-- can collide. (PostgreSQL 11+ adds a defaulted column without rewriting the
-- table, so this does not take a long ACCESS EXCLUSIVE lock on a large table.)
--
-- Why widen it at all: a day can be closed for two independent reasons at once
-- — the owner blocked it AND Airbnb has a guest that night. Sharing one row
-- meant the second writer overwrote the first, and cancelling the Airbnb
-- booking would then delete a block the owner had made by hand. Each reason now
-- owns its row, keyed by 'LOCAL' or by the feed id, so syncing one feed can
-- never remove another source's days. The full reasoning is on the model in
-- prisma/schema.prisma.
--
-- NOTE for anyone adding a query later: rows are now *reasons*, not days. A
-- COUNT over this table counts reasons. Occupancy counts distinct
-- (listingId, date) pairs — see src/lib/owner-insights.ts.
-- ---------------------------------------------------------------------------

-- DropIndex
DROP INDEX "Availability_listingId_date_key";

-- AlterTable
ALTER TABLE "Availability" ADD COLUMN     "feedId" TEXT,
ADD COLUMN     "sourceKey" TEXT NOT NULL DEFAULT 'LOCAL';

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "calendarToken" TEXT;

-- CreateTable
CREATE TABLE "CalendarFeed" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ICAL',
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastEventCount" INTEGER NOT NULL DEFAULT 0,
    "lastDayCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarFeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarFeed_listingId_active_idx" ON "CalendarFeed"("listingId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeed_listingId_url_key" ON "CalendarFeed"("listingId", "url");

-- CreateIndex
CREATE INDEX "Availability_feedId_idx" ON "Availability"("feedId");

-- CreateIndex
CREATE UNIQUE INDEX "Availability_listingId_date_sourceKey_key" ON "Availability"("listingId", "date", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_calendarToken_key" ON "Listing"("calendarToken");

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "CalendarFeed"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarFeed" ADD CONSTRAINT "CalendarFeed_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

