import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { todayISO } from "@/lib/dates";

/**
 * Platform-wide public holidays — the dates marked on «التقويم الشامل».
 *
 * A holiday is never read by pricing. It is *copied* into each listing as an
 * ordinary `SpecialDay` (tagged with `publicHolidayId`), so the night prices at
 * that listing's own `holidayPrice` through the path that already exists, and
 * the owner can unmark the copy or add days of their own exactly as before.
 *
 * `skipDuplicates` leans on @@unique([listingId, date]): a day the owner had
 * already marked keeps the owner's row and label rather than being overwritten.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** Copy one holiday into every listing that has nothing marked on its date. */
export async function fanOutPublicHoliday(
  db: Db,
  holiday: { id: string; date: string; label: string },
): Promise<number> {
  const listings = await db.listing.findMany({ select: { id: true } });
  if (listings.length === 0) return 0;

  const { count } = await db.specialDay.createMany({
    data: listings.map((l) => ({
      listingId: l.id,
      date: holiday.date,
      label: holiday.label,
      publicHolidayId: holiday.id,
    })),
    skipDuplicates: true,
  });
  return count;
}

/**
 * Give a newly created listing every holiday from today on.
 *
 * Without it a listing added after the operator set up the year would be the
 * one rest house on the site still charging its weekday rate on Eid.
 */
export async function copyPublicHolidaysTo(listingId: string): Promise<void> {
  const holidays = await prisma.publicHoliday.findMany({
    where: { date: { gte: todayISO() } },
    select: { id: true, date: true, label: true },
  });
  if (holidays.length === 0) return;

  await prisma.specialDay.createMany({
    data: holidays.map((h) => ({
      listingId,
      date: h.date,
      label: h.label,
      publicHolidayId: h.id,
    })),
    skipDuplicates: true,
  });
}
