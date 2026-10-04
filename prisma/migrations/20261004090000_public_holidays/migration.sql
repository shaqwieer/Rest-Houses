-- Platform-wide public holidays («التقويم الشامل», /admin/holidays).
--
-- Additive only: a new table, and a nullable column on "SpecialDay" with no
-- default, so no existing row is rewritten and nothing reprices on release.
-- Every existing special day stays an owner's own (publicHolidayId NULL).

-- AlterTable
ALTER TABLE "SpecialDay" ADD COLUMN     "publicHolidayId" TEXT;

-- CreateTable
CREATE TABLE "PublicHoliday" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicHoliday_date_key" ON "PublicHoliday"("date");

-- CreateIndex
CREATE INDEX "SpecialDay_publicHolidayId_idx" ON "SpecialDay"("publicHolidayId");

-- AddForeignKey
ALTER TABLE "SpecialDay" ADD CONSTRAINT "SpecialDay_publicHolidayId_fkey" FOREIGN KEY ("publicHolidayId") REFERENCES "PublicHoliday"("id") ON DELETE CASCADE ON UPDATE CASCADE;

