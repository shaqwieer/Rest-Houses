import { prisma } from "@/lib/prisma";
import { todayISO } from "@/lib/dates";
import { CALENDAR_PLATFORM_NAMES, type CalendarPlatform } from "@/lib/constants";
import { getCalendarExportUrl, listCalendarFeeds } from "./feeds";
import type { AvailabilityEntry } from "@/components/admin/availability-editor";

/**
 * Everything one calendar page renders, for one listing.
 *
 * Shared by /admin/calendar and /owner/calendar. The two pages differ only in
 * *which listings they may choose between* — resolved by their own guards
 * before they get here — so the data-loading below is identical and lives once.
 * Duplicating it was the alternative, and the copy that drifts is always the
 * one that forgets to collapse a day's several rows into one cell.
 */
export async function loadCalendarBoard(listingId: string) {
  const [rows, specialDays, feeds, exportUrl] = await Promise.all([
    // Only from today forward — past days aren't editable, so shipping years of
    // history to the client would be dead weight.
    //
    // `feed` comes along so an imported day can name the platform holding it.
    // Someone looking at a cell they cannot clear needs to know whether the
    // remedy is "cancel the booking here" or "it is sold on Airbnb".
    prisma.availability.findMany({
      where: { listingId, date: { gte: todayISO() } },
      select: {
        date: true,
        status: true,
        feed: { select: { platform: true, label: true } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.specialDay.findMany({
      where: { listingId, date: { gte: todayISO() } },
      select: { date: true, label: true },
      orderBy: { date: "asc" },
    }),
    listCalendarFeeds(listingId),
    getCalendarExportUrl(listingId),
  ]);

  // One day can carry several availability rows — an owner block and an
  // imported hold are independent reasons. Collapse to the one status the cell
  // shows, by the precedence documented on `getAvailabilityMap` in
  // src/lib/listings.ts: BOOKED > EXTERNAL > BLOCKED, strongest claim first.
  const rank: Record<string, number> = { BLOCKED: 0, EXTERNAL: 1, BOOKED: 2 };
  const merged = new Map<string, AvailabilityEntry>();

  for (const row of rows) {
    const status: AvailabilityEntry["status"] =
      row.status === "BOOKED" ? "BOOKED" : row.status === "EXTERNAL" ? "EXTERNAL" : "BLOCKED";
    const current = merged.get(row.date);
    if (current && rank[current.status] >= rank[status]) continue;

    merged.set(row.date, {
      date: row.date,
      status,
      source:
        status === "EXTERNAL" && row.feed
          ? row.feed.label ||
            CALENDAR_PLATFORM_NAMES[row.feed.platform as CalendarPlatform] ||
            ""
          : undefined,
    });
  }

  return {
    entries: [...merged.values()],
    specialDays,
    feeds,
    exportUrl,
  };
}
