import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createListing, ensureSchema, prisma, resetDatabase } from "./db";
import { addDays, todayISO } from "@/lib/dates";
import { LOCAL_SOURCE_KEY } from "@/lib/constants";
import { getUnavailableDates, isRangeAvailable } from "@/lib/listings";
import { buildListingCalendar } from "@/lib/calendar/export";

/**
 * Calendar sync against a real database.
 *
 * The network is the only thing stubbed. Everything else — the reconciliation,
 * the transaction, the three-column unique key, the availability reads that
 * gate a booking — runs exactly as it does in production, because these
 * assertions are about *queries* and a mock would only prove the test agrees
 * with itself. Same reasoning as the note at the top of tests/db.ts.
 */

const TODAY = todayISO();
const D = (n: number) => addDays(TODAY, n);
/** `2026-09-10` → `20260910`, the VALUE=DATE form a feed carries. */
const ICS = (iso: string) => iso.replace(/-/g, "");

/** A feed body holding `[start, end)` — DTEND exclusive, as the platforms send. */
function feedBody(ranges: { start: string; end: string }[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Airbnb Inc//Hosting//EN",
    ...ranges.flatMap((r, i) => [
      "BEGIN:VEVENT",
      `UID:evt-${i}@airbnb.com`,
      `DTSTART;VALUE=DATE:${ICS(r.start)}`,
      `DTEND;VALUE=DATE:${ICS(r.end)}`,
      "SUMMARY:Reserved",
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ].join("\r\n");
}

/**
 * Stand in for the network.
 *
 * `fetchCalendar` is mocked rather than `global.fetch`, so the tests stay about
 * reconciliation. The SSRF guards, the redirect handling and the size cap that
 * live below it are covered as pure functions in tests/ical.test.ts.
 */
const fetchCalendar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/calendar/fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/calendar/fetch")>()),
  fetchCalendar,
}));

// Imported after the mock is registered.
const { syncFeed, syncListing } = await import("@/lib/calendar/sync");

function serves(body: string) {
  fetchCalendar.mockResolvedValue({ ok: true, body });
}
function fails(failure = "TIMEOUT") {
  fetchCalendar.mockResolvedValue({ ok: false, failure });
}

async function makeFeed(listingId: string, platform = "AIRBNB", url?: string) {
  return prisma.calendarFeed.create({
    data: {
      listingId,
      platform,
      kind: "ICAL",
      url: url ?? `https://www.airbnb.com/calendar/ical/${platform}-${listingId}.ics`,
    },
    select: { id: true, listingId: true, platform: true, url: true, kind: true },
  });
}

/** Every imported date for one feed. */
async function importedDays(feedId: string): Promise<string[]> {
  const rows = await prisma.availability.findMany({
    where: { sourceKey: feedId },
    select: { date: true },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => r.date);
}

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDatabase();
  fetchCalendar.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("importing a feed", () => {
  it("blocks the nights of an external booking, DTEND exclusive", async () => {
    const listing = await createListing();
    const feed = await makeFeed(listing.id);
    serves(feedBody([{ start: D(5), end: D(8) }]));

    const result = await syncFeed(feed);

    expect(result.ok).toBe(true);
    // Three nights held; the checkout morning stays free for the next arrival.
    expect(await importedDays(feed.id)).toEqual([D(5), D(6), D(7)]);
    expect(result.days).toBe(3);
  });

  it("makes those days unbookable through the normal availability checks", async () => {
    const listing = await createListing();
    const feed = await makeFeed(listing.id);
    serves(feedBody([{ start: D(5), end: D(8) }]));
    await syncFeed(feed);

    // The existence-based reads the whole app gates bookings on. Neither knows
    // external calendars exist, and neither had to be changed.
    expect(await isRangeAvailable(listing.id, D(5), D(6))).toBe(false);
    // Arriving D(4) and leaving D(5) occupies only the night of D(4) — free.
    expect(await isRangeAvailable(listing.id, D(4), D(5))).toBe(true);
    // Extend it one night and it now crosses the held D(5). Refused.
    expect(await isRangeAvailable(listing.id, D(4), D(6))).toBe(false);
    // D(8) is the external booking's checkout morning: bookable again.
    expect(await isRangeAvailable(listing.id, D(8), D(9))).toBe(true);
    expect([...(await getUnavailableDates(listing.id))].sort()).toEqual([D(5), D(6), D(7)]);
  });

  it("stores imported days as EXTERNAL, keyed to the feed", async () => {
    const listing = await createListing();
    const feed = await makeFeed(listing.id);
    serves(feedBody([{ start: D(1), end: D(2) }]));
    await syncFeed(feed);

    const row = await prisma.availability.findFirstOrThrow({ where: { date: D(1) } });
    expect(row.status).toBe("EXTERNAL");
    expect(row.sourceKey).toBe(feed.id);
    expect(row.feedId).toBe(feed.id);
  });

  it("ignores days in the past", async () => {
    const listing = await createListing();
    const feed = await makeFeed(listing.id);
    serves(feedBody([{ start: D(-5), end: D(2) }]));
    await syncFeed(feed);

    expect(await importedDays(feed.id)).toEqual([D(0), D(1)]);
  });
});

describe("reconciliation", () => {
  it("clears only that feed's days when a valid calendar comes back empty", async () => {
    const listing = await createListing();
    const feed = await makeFeed(listing.id);

    serves(feedBody([{ start: D(5), end: D(8) }]));
    await syncFeed(feed);
    expect(await importedDays(feed.id)).toHaveLength(3);

    // Everything cancelled on the other platform. A *valid* empty calendar —
    // this must reconcile and release the days.
    serves(feedBody([]));
    const result = await syncFeed(feed);

    expect(result.ok).toBe(true);
    expect(await importedDays(feed.id)).toEqual([]);
    expect(await isRangeAvailable(listing.id, D(5), D(6))).toBe(true);
  });

  it("PRESERVES imported days when the fetch fails", async () => {
    const listing = await createListing();
    const feed = await makeFeed(listing.id);

    serves(feedBody([{ start: D(5), end: D(8) }]));
    await syncFeed(feed);

    // Airbnb times out. Clearing the days here would put three sold nights back
    // on the market — the exact harm this feature exists to prevent.
    fails("TIMEOUT");
    const result = await syncFeed(feed);

    expect(result.ok).toBe(false);
    expect(result.failure).toBe("TIMEOUT");
    expect(await importedDays(feed.id)).toEqual([D(5), D(6), D(7)]);
    expect(await isRangeAvailable(listing.id, D(5), D(6))).toBe(false);
  });

  it("PRESERVES imported days when a 200 response is not a calendar", async () => {
    const listing = await createListing();
    const feed = await makeFeed(listing.id);

    serves(feedBody([{ start: D(5), end: D(8) }]));
    await syncFeed(feed);

    // An expired token often answers 200 with a sign-in page. It parses to zero
    // events, and reconciling against zero would free every night.
    serves("<!DOCTYPE html><html><body>Please sign in</body></html>");
    const result = await syncFeed(feed);

    expect(result.ok).toBe(false);
    expect(result.failure).toBe("NOT_CALENDAR");
    expect(await importedDays(feed.id)).toEqual([D(5), D(6), D(7)]);
  });

  it("records the failure without moving the last-success timestamp", async () => {
    const listing = await createListing();
    const feed = await makeFeed(listing.id);

    serves(feedBody([{ start: D(5), end: D(6) }]));
    await syncFeed(feed);
    const afterOk = await prisma.calendarFeed.findUniqueOrThrow({ where: { id: feed.id } });

    fails("HTTP_ERROR");
    await syncFeed(feed);
    const afterFail = await prisma.calendarFeed.findUniqueOrThrow({ where: { id: feed.id } });

    expect(afterFail.lastError).toBe("HTTP_ERROR");
    // Attempted since; last *succeeded* unchanged. That difference is what
    // tells an owner the feed has been broken since Tuesday.
    expect(afterFail.lastSyncedAt!.getTime()).toBeGreaterThanOrEqual(
      afterOk.lastSyncedAt!.getTime(),
    );
    expect(afterFail.lastOkAt!.getTime()).toBe(afterOk.lastOkAt!.getTime());
  });

  it("returns a failure instead of throwing when the write is refused", async () => {
    // `syncDueFeeds` hands four of these to `Promise.all`, so a rejection out of
    // `syncFeed` would discard three siblings' results and fail the whole cron
    // run — one owner's unlucky moment stopping everyone else's calendar.
    //
    // Provoked with a real database error rather than a stubbed client: the
    // feed is deleted while its fetch is "in flight", so the foreign key on
    // Availability.feedId refuses the insert. That is one of the genuine ways
    // this transaction fails in production, and it exercises the rollback too.
    const listing = await createListing();
    const feed = await makeFeed(listing.id);
    serves(feedBody([{ start: D(5), end: D(6) }]));

    await prisma.calendarFeed.delete({ where: { id: feed.id } });

    const result = await syncFeed(feed);

    expect(result.ok).toBe(false);
    expect(result.failure).toBe("WRITE_FAILED");
    // Rolled back whole: no orphan day survived the failed transaction.
    expect(await prisma.availability.count({ where: { listingId: listing.id } })).toBe(0);
  });

  it("clears the error once the feed recovers", async () => {
    const listing = await createListing();
    const feed = await makeFeed(listing.id);

    fails("NETWORK");
    await syncFeed(feed);
    serves(feedBody([{ start: D(3), end: D(4) }]));
    await syncFeed(feed);

    const row = await prisma.calendarFeed.findUniqueOrThrow({ where: { id: feed.id } });
    expect(row.lastError).toBeNull();
    expect(row.lastDayCount).toBe(1);
  });
});

describe("sources stay separate", () => {
  it("syncing Airbnb never removes days imported from Booking.com", async () => {
    const listing = await createListing();
    const airbnb = await makeFeed(listing.id, "AIRBNB");
    const booking = await makeFeed(listing.id, "BOOKING");

    serves(feedBody([{ start: D(5), end: D(6) }]));
    await syncFeed(airbnb);
    serves(feedBody([{ start: D(9), end: D(10) }]));
    await syncFeed(booking);

    // Airbnb now says it holds nothing. Booking.com's day must survive.
    serves(feedBody([]));
    await syncFeed(airbnb);

    expect(await importedDays(airbnb.id)).toEqual([]);
    expect(await importedDays(booking.id)).toEqual([D(9)]);
    expect(await isRangeAvailable(listing.id, D(9), D(10))).toBe(false);
  });

  it("lets two platforms hold the same day as two rows", async () => {
    const listing = await createListing();
    const airbnb = await makeFeed(listing.id, "AIRBNB");
    const booking = await makeFeed(listing.id, "BOOKING");

    serves(feedBody([{ start: D(5), end: D(6) }]));
    await syncFeed(airbnb);
    await syncFeed(booking);

    // Two reasons, two rows, one closed day — the whole point of widening the
    // unique key. Under the old @@unique([listingId, date]) this threw.
    expect(await prisma.availability.count({ where: { date: D(5) } })).toBe(2);
    expect([...(await getUnavailableDates(listing.id))]).toEqual([D(5)]);

    // And releasing one leaves the day closed by the other.
    serves(feedBody([]));
    await syncFeed(airbnb);
    expect(await isRangeAvailable(listing.id, D(5), D(6))).toBe(false);
  });

  it("keeps an owner's manual block when the external booking is cancelled", async () => {
    const listing = await createListing();
    const feed = await makeFeed(listing.id);

    // The owner closes D(5) for maintenance…
    await prisma.availability.create({
      data: { listingId: listing.id, date: D(5), status: "BLOCKED", sourceKey: LOCAL_SOURCE_KEY },
    });
    // …and Airbnb happens to hold the same day.
    serves(feedBody([{ start: D(5), end: D(6) }]));
    await syncFeed(feed);

    // Airbnb releases it. The owner never withdrew their block, so the day
    // stays closed. Sharing one row would have lost this.
    serves(feedBody([]));
    await syncFeed(feed);

    expect(await isRangeAvailable(listing.id, D(5), D(6))).toBe(false);
    const remaining = await prisma.availability.findMany({ where: { date: D(5) } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe("BLOCKED");
    expect(remaining[0].sourceKey).toBe(LOCAL_SOURCE_KEY);
  });

  it("keeps a confirmed booking's nights when a feed is deleted", async () => {
    const listing = await createListing();
    const feed = await makeFeed(listing.id);

    await prisma.availability.create({
      data: { listingId: listing.id, date: D(5), status: "BOOKED", sourceKey: LOCAL_SOURCE_KEY },
    });
    serves(feedBody([{ start: D(5), end: D(7) }]));
    await syncFeed(feed);

    // Deleting the feed cascades away its imported days and nothing else.
    await prisma.calendarFeed.delete({ where: { id: feed.id } });

    const rows = await prisma.availability.findMany({ where: { listingId: listing.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("BOOKED");
    expect(await isRangeAvailable(listing.id, D(5), D(6))).toBe(false);
  });

  it("syncs every active feed on a listing and skips paused ones", async () => {
    const listing = await createListing();
    await makeFeed(listing.id, "AIRBNB");
    const paused = await makeFeed(listing.id, "BOOKING");
    await prisma.calendarFeed.update({ where: { id: paused.id }, data: { active: false } });

    serves(feedBody([{ start: D(2), end: D(3) }]));
    const results = await syncListing(listing.id);

    expect(results).toHaveLength(1);
    expect(await importedDays(paused.id)).toEqual([]);
  });
});

/**
 * Occupancy is the ONE place the widened unique key changes arithmetic rather
 * than membership: every other read is an existence test, where a duplicate row
 * is harmless. Counting rows here would count *reasons a day is closed* instead
 * of days, and push the figure past 100%.
 */
describe("occupancy counts days, not reasons", () => {
  /** The query shape used by admin/page.tsx and owner-insights.ts. */
  async function soldDays(listingId: string): Promise<number> {
    const rows = await prisma.availability.findMany({
      where: { listingId, status: { in: ["BOOKED", "EXTERNAL"] }, date: { gte: TODAY } },
      select: { listingId: true, date: true },
      distinct: ["listingId", "date"],
    });
    return rows.length;
  }

  it("counts a night that is both booked here and held by a feed exactly once", async () => {
    const listing = await createListing();
    const feed = await makeFeed(listing.id);

    await prisma.availability.create({
      data: { listingId: listing.id, date: D(5), status: "BOOKED", sourceKey: LOCAL_SOURCE_KEY },
    });
    serves(feedBody([{ start: D(5), end: D(6) }]));
    await syncFeed(feed);

    // Two rows for the one night…
    expect(await prisma.availability.count({ where: { date: D(5) } })).toBe(2);
    // …and one sold day. Counting rows would report 2 of a possible 1.
    expect(await soldDays(listing.id)).toBe(1);
  });

  it("counts a day held by two different platforms once", async () => {
    const listing = await createListing();
    const airbnb = await makeFeed(listing.id, "AIRBNB");
    const booking = await makeFeed(listing.id, "BOOKING");

    serves(feedBody([{ start: D(3), end: D(4) }]));
    await syncFeed(airbnb);
    await syncFeed(booking);

    expect(await soldDays(listing.id)).toBe(1);
  });

  it("counts external nights as sold but leaves owner blocks out", async () => {
    const listing = await createListing();
    const feed = await makeFeed(listing.id);

    // A day closed for maintenance is not demand and must not flatter the
    // figure; a night sold on Airbnb is a night the rest house is full.
    await prisma.availability.create({
      data: { listingId: listing.id, date: D(9), status: "BLOCKED", sourceKey: LOCAL_SOURCE_KEY },
    });
    serves(feedBody([{ start: D(2), end: D(4) }]));
    await syncFeed(feed);

    expect(await soldDays(listing.id)).toBe(2);
  });
});

describe("export", () => {
  it("publishes confirmed bookings and owner blocks as separate merged ranges", async () => {
    const listing = await createListing({ name: "Al Badia" });

    for (const date of [D(1), D(2), D(3)]) {
      await prisma.availability.create({
        data: { listingId: listing.id, date, status: "BOOKED", sourceKey: LOCAL_SOURCE_KEY },
      });
    }
    await prisma.availability.create({
      data: { listingId: listing.id, date: D(10), status: "BLOCKED", sourceKey: LOCAL_SOURCE_KEY },
    });

    const body = await buildListingCalendar({
      listingId: listing.id,
      listingName: listing.name,
      dtstamp: "20260809T120000Z",
      from: TODAY,
    });

    // Three consecutive booked nights become one event, DTEND the morning after.
    expect(body).toContain(`DTSTART;VALUE=DATE:${ICS(D(1))}`);
    expect(body).toContain(`DTEND;VALUE=DATE:${ICS(D(4))}`);
    expect(body).toContain("SUMMARY:Booked");
    expect(body).toContain(`DTSTART;VALUE=DATE:${ICS(D(10))}`);
    expect(body).toContain("SUMMARY:Unavailable");
  });

  it("never re-exports imported days, so no loop can form", async () => {
    const listing = await createListing();
    const feed = await makeFeed(listing.id);
    serves(feedBody([{ start: D(5), end: D(8) }]));
    await syncFeed(feed);

    const body = await buildListingCalendar({
      listingId: listing.id,
      listingName: listing.name,
      dtstamp: "20260809T120000Z",
      from: TODAY,
    });

    // The days are genuinely blocked here…
    expect(await isRangeAvailable(listing.id, D(5), D(6))).toBe(false);
    // …and deliberately absent from what we publish back.
    expect(body).not.toContain(ICS(D(5)));
    expect(body).not.toContain("BEGIN:VEVENT");
  });

  it("carries no guest details", async () => {
    const listing = await createListing();
    await prisma.availability.create({
      data: {
        listingId: listing.id,
        date: D(1),
        status: "BOOKED",
        sourceKey: LOCAL_SOURCE_KEY,
        note: "Fatima Al Mansouri · 971501234567",
      },
    });

    const body = await buildListingCalendar({
      listingId: listing.id,
      listingName: listing.name,
      dtstamp: "20260809T120000Z",
      from: TODAY,
    });

    // The note column is not read at all, and nothing identifying reaches the
    // feed. This URL is public by design.
    expect(body).not.toContain("Fatima");
    expect(body).not.toContain("971501234567");
    expect(body).not.toContain(listing.id);
    expect(body).toContain("SUMMARY:Booked");
  });
});
