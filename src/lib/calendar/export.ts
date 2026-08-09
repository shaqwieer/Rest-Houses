/**
 * The outbound half of calendar sync: this listing's busy days as an .ics that
 * Airbnb and Booking.com can import.
 *
 * Without this the sync is one-directional and the obvious failure returns —
 * a guest books here, nothing tells Airbnb, and Airbnb sells the same night.
 *
 * ─── What goes in, and the two things that must never ───────────────────────
 * In: confirmed bookings taken on this platform, and days the owner blocked by
 * hand. Both are facts this platform owns and both close the rest house.
 *
 * Never, #1 — guest details. This URL is unauthenticated by design; it is given
 * to another company's crawler and anyone who has it can read it. So an event
 * says a date range is unavailable and nothing else. No name, no number, no
 * reference, no price. `buildICal` has the same note for the same reason.
 *
 * Never, #2 — imported days. Rows with `status = "EXTERNAL"` came *from* an
 * external calendar and are deliberately excluded, which is what stops a loop:
 * re-exporting Airbnb's own booking back to Airbnb would have this platform
 * asserting a hold it did not create and cannot release. When Airbnb cancels,
 * the day vanishes from their feed and from our imported rows — but a copy we
 * had already published would keep asserting it, and each side would then be
 * holding the day open because the other appears to.
 *
 * ─── The reflection this does NOT prevent, stated plainly ───────────────────
 * The exclusion is one-directional. It stops Airbnb → us → Airbnb. It does not
 * stop us → Airbnb → us: a booking confirmed *here* is exported, the other
 * platform imports it as a block, its own export re-advertises that block
 * (Booking.com's export dialog offers "Booked **and closed** dates", which
 * includes it), and our next sync reads it back as an EXTERNAL row.
 *
 * That is self-healing rather than a true loop — cancel here, the day leaves
 * our feed, they drop the block, our next sync drops the row — but the round
 * trip costs two of *their* refresh cycles. So a cancelled booking can leave
 * the day showing unavailable here for several hours after it was released.
 * An owner who has pasted our export URL into Booking.com should choose
 * "Booked dates only" there, which avoids the reflection entirely.
 *
 * Fixing it properly means a token per consumer so each platform's own days can
 * be excluded from its own export — see the hub note below.
 *
 * The cost of that exclusion, stated plainly: a booking on Airbnb does not
 * reach Booking.com through this platform. Each platform learns only about
 * bookings made *here*, and about each other only if the owner also pastes each
 * one's export URL into the other. Making this a hub — re-exporting each feed's
 * days to every *other* feed — is possible on this schema (the rows are already
 * tagged per feed) but is deliberately not done yet: it needs a token per
 * consumer so a feed can be excluded from its own export, and getting that
 * wrong is how a loop starts.
 */

import { prisma } from "@/lib/prisma";
import { LOCAL_SOURCE_KEY } from "@/lib/constants";
import { addDays, todayISO, type ISODate } from "@/lib/dates";
import { buildICal, type ExportEvent } from "./ical";

/**
 * How far ahead to publish. Two years covers every real booking horizon and
 * bounds the response for a listing whose owner has blocked a decade.
 */
const HORIZON_DAYS = 730;

/** Summaries are plain English: the consumer is another platform, not a person. */
const SUMMARY: Record<string, string> = {
  BOOKED: "Booked",
  BLOCKED: "Unavailable",
};

/**
 * Consecutive days → half-open ranges.
 *
 * One VEVENT per range rather than per day. A month blocked for maintenance is
 * one event instead of thirty, which keeps the feed small, and — more usefully
 * — makes it read the way a booking reads in the importing platform's UI.
 *
 * The `end` returned is EXCLUSIVE: the morning after the last held night. That
 * matches DTEND in RFC 5545 and `BookingRequest.checkOut` here, so the value is
 * the same convention at every step of the round trip.
 */
export function groupIntoRanges(days: ISODate[]): { start: ISODate; end: ISODate }[] {
  const sorted = [...new Set(days)].sort();
  const ranges: { start: ISODate; end: ISODate }[] = [];

  for (const day of sorted) {
    const last = ranges[ranges.length - 1];
    // `last.end` is already the exclusive morning after the previous day, so a
    // day that continues the run is exactly equal to it.
    if (last && last.end === day) last.end = addDays(day, 1);
    else ranges.push({ start: day, end: addDays(day, 1) });
  }

  return ranges;
}

/**
 * Build the .ics body for a listing.
 *
 * `dtstamp` is passed in rather than read from the clock so the output is
 * deterministic and a test can assert on the whole body.
 */
export async function buildListingCalendar(input: {
  listingId: string;
  listingName: string;
  dtstamp: string;
  from?: ISODate;
}): Promise<string> {
  const from = input.from ?? todayISO();
  const until = addDays(from, HORIZON_DAYS);

  const rows = await prisma.availability.findMany({
    where: {
      listingId: input.listingId,
      // The exclusion that prevents the loop. Equivalent to filtering
      // `status: { in: ["BOOKED", "BLOCKED"] }`, expressed as the source
      // because *where the row came from* is the actual reason it is excluded —
      // a future non-iCal source would add a status but not change this rule.
      sourceKey: LOCAL_SOURCE_KEY,
      date: { gte: from, lt: until },
    },
    select: { date: true, status: true },
    orderBy: { date: "asc" },
  });

  // Grouped by status so a run of booked nights and a run of owner-blocked days
  // do not merge into one event that mislabels both. Only one LOCAL row can
  // exist per day, so the two sets never overlap.
  const byStatus = new Map<string, ISODate[]>();
  for (const row of rows) {
    const status = row.status === "BOOKED" ? "BOOKED" : "BLOCKED";
    const list = byStatus.get(status);
    if (list) list.push(row.date);
    else byStatus.set(status, [row.date]);
  }

  const events: ExportEvent[] = [];
  for (const [status, days] of byStatus) {
    for (const range of groupIntoRanges(days)) {
      events.push({
        // Stable across regenerations, so an importer updates the event it
        // already has instead of accumulating duplicates. Built from the range
        // and the status only — nothing here identifies the listing, the guest
        // or the booking.
        uid: `${status.toLowerCase()}-${range.start}-${range.end}@rest-houses`,
        start: range.start,
        end: range.end,
        summary: SUMMARY[status] ?? "Unavailable",
      });
    }
  }

  events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  return buildICal({ name: input.listingName, dtstamp: input.dtstamp, events });
}

/** `20260809T121500Z` — the DTSTAMP form. */
export function icalTimestamp(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}
