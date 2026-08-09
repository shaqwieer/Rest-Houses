/**
 * Reading calendar feeds for the UI.
 *
 * Kept apart from actions/calendar.ts so a server *page* can import it without
 * pulling in a `"use server"` module, and apart from sync.ts so rendering the
 * panel never drags the fetch/parse machinery into the page bundle graph.
 */

import { prisma } from "@/lib/prisma";
import { CALENDAR_PLATFORM_NAMES, type CalendarPlatform } from "@/lib/constants";

/**
 * What the panel renders. Note what is NOT here: the feed URL.
 *
 * An iCal export URL carries a token that grants read access to that listing's
 * calendar on Airbnb or Booking.com — it is a credential, and this project's
 * habit with credentials is that they go in and never come back out. The panel
 * shows `urlHint` (the host plus a short tail) which is enough for an owner to
 * tell two feeds apart and not enough for anyone reading over their shoulder,
 * or reading a cached RSC payload, to use it.
 */
export type CalendarFeedView = {
  id: string;
  platform: CalendarPlatform;
  /** Display name: the platform, or the owner's own label for an "OTHER" feed. */
  name: string;
  label: string;
  urlHint: string;
  active: boolean;
  lastSyncedAt: Date | null;
  lastOkAt: Date | null;
  lastError: string | null;
  lastDayCount: number;
};

/** `https://www.airbnb.com/calendar/ical/123.ics?s=abc…` → `www.airbnb.com/…c9f2` */
export function hintForUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // The last four characters of the token, which is the part that differs
    // between two feeds from the same platform.
    const tail = parsed.search.slice(-4) || parsed.pathname.slice(-4);
    return `${parsed.host}/…${tail}`;
  } catch {
    return "…";
  }
}

export async function listCalendarFeeds(listingId: string): Promise<CalendarFeedView[]> {
  const rows = await prisma.calendarFeed.findMany({
    where: { listingId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      platform: true,
      label: true,
      url: true,
      active: true,
      lastSyncedAt: true,
      lastOkAt: true,
      lastError: true,
      lastDayCount: true,
    },
  });

  return rows.map((row) => {
    const platform = row.platform as CalendarPlatform;
    return {
      id: row.id,
      platform,
      name: CALENDAR_PLATFORM_NAMES[platform] || row.label,
      label: row.label,
      urlHint: hintForUrl(row.url),
      active: row.active,
      lastSyncedAt: row.lastSyncedAt,
      lastOkAt: row.lastOkAt,
      lastError: row.lastError,
      lastDayCount: row.lastDayCount,
    };
  });
}

/**
 * The public .ics URL for a listing, or null when export has not been enabled.
 *
 * Absolute, because its whole purpose is to be pasted into another company's
 * form. `NEXT_PUBLIC_SITE_URL` is the same variable the review invite links and
 * the sitemap already build from, so a deployment that has it wrong has it
 * wrong everywhere rather than only here.
 */
export async function getCalendarExportUrl(listingId: string): Promise<string | null> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { calendarToken: true },
  });
  if (!listing?.calendarToken) return null;

  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  return `${base}/api/calendar/${listing.calendarToken}.ics`;
}
