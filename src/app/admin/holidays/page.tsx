import { PublicHolidaysEditor } from "@/components/admin/public-holidays-editor";
import { prisma } from "@/lib/prisma";
import { todayISO } from "@/lib/dates";
import { requireAdminPage } from "@/lib/auth";

/** «التقويم الشامل» — public holidays marked once for every rest house. */
export default async function AdminHolidaysPage() {
  await requireAdminPage();

  const today = todayISO();
  const [holidays, listings, copies] = await Promise.all([
    prisma.publicHoliday.findMany({
      where: { date: { gte: today } },
      select: { id: true, date: true, label: true },
      orderBy: { date: "asc" },
    }),
    prisma.listing.findMany({
      select: { id: true, name: true, holidayPrice: true },
      orderBy: { createdAt: "asc" },
    }),
    // How many listings still carry each holiday — an owner who unmarked their
    // copy is the difference, and the operator should be able to see it.
    prisma.specialDay.groupBy({
      by: ["publicHolidayId"],
      where: { publicHolidayId: { not: null }, date: { gte: today } },
      _count: { _all: true },
    }),
  ]);

  const copiesById = new Map(copies.map((c) => [c.publicHolidayId, c._count._all]));

  return (
    <PublicHolidaysEditor
      holidays={holidays.map((h) => ({ ...h, listings: copiesById.get(h.id) ?? 0 }))}
      listingCount={listings.length}
      // A listing with no occasion rate keeps its normal price on every
      // holiday. Named on the page so the operator knows whom to chase, rather
      // than marking Eid and wondering why some prices never moved.
      withoutRate={listings
        .filter((l) => l.holidayPrice <= 0)
        .map((l) => ({ id: l.id, name: l.name }))}
    />
  );
}
