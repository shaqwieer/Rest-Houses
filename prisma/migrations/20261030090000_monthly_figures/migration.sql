-- The monthly record («السجل الشهري», /admin/monthly).
--
-- Additive only: one new table, empty on release. Nothing is backfilled here —
-- the first visit to the dashboard after deploy freezes every month that has
-- already settled, from the same predicate the overview's tiles use.

-- CreateTable
CREATE TABLE "MonthlyFigure" (
    "month" TEXT NOT NULL,
    "bookings" INTEGER NOT NULL,
    "revenue" INTEGER NOT NULL,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyFigure_pkey" PRIMARY KEY ("month")
);
