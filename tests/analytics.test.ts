import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { createListing, createOwner, ensureSchema, prisma, resetDatabase, seedSettings } from "./db";
import { change, getAnalytics, resolvePeriod, MAX_CUSTOM_DAYS } from "@/lib/analytics";
import { analyticsWorkbook, analyticsFilename, workbookResponse } from "@/lib/analytics-export";
import { cellAt, readSheet, rowOf } from "./xlsx-read";
import { ar } from "@/lib/i18n/ar";
import { addDays, todayISO } from "@/lib/dates";

/**
 * The performance dashboard shared by the owner and the operator.
 *
 * What is worth asserting here is the *definitions* and the *scoping*, not the
 * arithmetic. A future change can quietly break either while every number on
 * screen still looks plausible:
 *
 *  • which money is counted (subtotal, not total; net after commission)
 *  • what occupancy is a fraction of, and that an imported night counts as sold
 *  • that a day-use booking — `nights = 0` — does not make a per-day average
 *    infinite
 *  • that an owner cannot widen their scope by supplying a listing id
 */

beforeAll(() => {
  ensureSchema();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await seedSettings({ serviceFeePercent: 10 });
});

const today = todayISO();

/** The default view: the thirty days ending today. */
function period30() {
  return resolvePeriod({ period: "30d" }, today);
}

async function booking(
  listingId: string,
  opts: {
    status?: string;
    checkIn?: string;
    nights?: number;
    dayUse?: boolean;
    subtotal?: number;
    commissionDue?: number;
    source?: string;
  } = {},
) {
  const checkIn = opts.checkIn ?? addDays(today, -5);
  const dayUse = opts.dayUse ?? false;
  const nights = dayUse ? 0 : (opts.nights ?? 2);
  const subtotal = opts.subtotal ?? 1_000;

  return prisma.bookingRequest.create({
    data: {
      reference: `RQ-${Math.floor(Math.random() * 1_000_000)}-${Date.now()}`,
      listingId,
      customerName: "Guest",
      customerPhone: "+971501111111",
      checkIn,
      // A day-use booking stores checkOut === checkIn, which is the literal
      // truth and what the production booking flow writes.
      checkOut: dayUse ? checkIn : addDays(checkIn, nights),
      nights,
      dayUse,
      guests: 10,
      subtotal,
      serviceFee: 100,
      total: subtotal + 100,
      depositDue: 0,
      depositPercent: 0,
      commissionDue: opts.commissionDue ?? 0,
      status: opts.status ?? "CONFIRMED",
      // Left to the column default unless a case is about sources — every row
      // that predates the column is a booking the public flow took.
      ...(opts.source ? { source: opts.source } : {}),
    },
  });
}

/** Mark days sold, the way confirming a request does. */
async function sell(listingId: string, from: string, days: number, status = "BOOKED") {
  for (let i = 0; i < days; i++) {
    await prisma.availability.create({
      data: {
        listingId,
        date: addDays(from, i),
        status,
        sourceKey: status === "EXTERNAL" ? "feed" : "LOCAL",
      },
    });
  }
}

/* -------------------------------------------------------------------------- */

describe("the period", () => {
  it("ends today, inclusive", () => {
    const { range } = resolvePeriod({ period: "7d" }, "2026-08-12");
    expect(range.from).toBe("2026-08-06");
    expect(range.lastDay).toBe("2026-08-12");
    expect(range.days).toBe(7);
    // Exclusive end, matching every other date query in the codebase.
    expect(range.to).toBe("2026-08-13");
  });

  it("compares against an equally long window immediately before it", () => {
    const { range, previous } = resolvePeriod({ period: "30d" }, "2026-08-12");
    expect(previous.days).toBe(range.days);
    expect(previous.to).toBe(range.from);
    expect(previous.from).toBe("2026-06-14");
  });

  it("reads a custom range inclusively at both ends", () => {
    const { range } = resolvePeriod(
      { period: "custom", from: "2026-08-01", to: "2026-08-31" },
      "2026-08-12",
    );
    expect(range.from).toBe("2026-08-01");
    expect(range.lastDay).toBe("2026-08-31");
    // The whole month, not thirty of its days — the last day must not be lost
    // to the half-open comparison.
    expect(range.days).toBe(31);
  });

  it("falls back to the default rather than erroring on a bad custom range", () => {
    // A mistyped date in a URL should show something, not an error page.
    for (const params of [
      { period: "custom" },
      { period: "custom", from: "not-a-date", to: "2026-08-31" },
      { period: "custom", from: "2026-08-31", to: "2026-08-01" },
      { period: "2026-02-31" },
    ]) {
      expect(resolvePeriod(params, "2026-08-12").range.days).toBe(30);
    }
  });

  it("caps a custom range instead of reading a decade", () => {
    const { range } = resolvePeriod(
      { period: "custom", from: "2000-01-01", to: "2026-08-31" },
      "2026-08-12",
    );
    expect(range.days).toBe(MAX_CUSTOM_DAYS);
    // The end the reader asked for is kept; the start is pulled in.
    expect(range.lastDay).toBe("2026-08-31");
  });
});

/* -------------------------------------------------------------------------- */

describe("what counts as revenue", () => {
  it("reports the subtotal, never the total the guest paid", async () => {
    const { owner } = await createOwner({ email: "rev@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    await booking(listing.id, { subtotal: 2_000 });

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    // total would be 2,100 — the extra 100 is the platform's service fee and
    // never the owner's money.
    expect(data.kpis.revenue).toBe(2_000);
  });

  it("takes the platform's commission off the net figure", async () => {
    const { owner } = await createOwner({ email: "net@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    await booking(listing.id, { subtotal: 2_000, commissionDue: 100 });

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    expect(data.kpis.revenue).toBe(2_000);
    expect(data.kpis.netRevenue).toBe(1_900);
  });

  it("counts only confirmed bookings", async () => {
    const { owner } = await createOwner({ email: "status@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    await booking(listing.id, { subtotal: 1_000 });
    await booking(listing.id, { subtotal: 5_000, status: "NEW" });
    await booking(listing.id, { subtotal: 5_000, status: "CANCELLED" });
    await booking(listing.id, { subtotal: 5_000, status: "REJECTED" });

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    expect(data.kpis.revenue).toBe(1_000);
    expect(data.kpis.bookings).toBe(1);
  });

  it("leaves a booking outside the period out of it", async () => {
    const { owner } = await createOwner({ email: "window@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    await booking(listing.id, { checkIn: addDays(today, -5), subtotal: 1_000 });
    await booking(listing.id, { checkIn: addDays(today, -200), subtotal: 9_000 });

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    expect(data.kpis.revenue).toBe(1_000);
  });
});

/* -------------------------------------------------------------------------- */

describe("day-use bookings", () => {
  /**
   * The trap this exists to catch. A day-use booking stores `nights = 0`, so
   * any per-day average that divides by `nights` is Infinity — on exactly the
   * bookings the "with and without an overnight stay" panel exists to compare.
   */
  it("does not make the average daily rate infinite", async () => {
    const { owner } = await createOwner({ email: "dayuse@test.ae" });
    const listing = await createListing({ ownerId: owner.id, dayUsePrice: 800 });
    await booking(listing.id, { dayUse: true, subtotal: 800 });

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    expect(Number.isFinite(data.kpis.avgDailyRate)).toBe(true);
    // One day occupied, 800 for it.
    expect(data.kpis.avgDailyRate).toBe(800);
  });

  it("separates the two kinds of stay", async () => {
    const { owner } = await createOwner({ email: "split@test.ae" });
    const listing = await createListing({ ownerId: owner.id, dayUsePrice: 500 });
    await booking(listing.id, { subtotal: 2_000, nights: 2 });
    await booking(listing.id, { dayUse: true, subtotal: 500 });
    await booking(listing.id, { dayUse: true, subtotal: 700 });

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    expect(data.overnight.bookings).toBe(1);
    expect(data.overnight.revenue).toBe(2_000);
    expect(data.dayUse.bookings).toBe(2);
    expect(data.dayUse.revenue).toBe(1_200);
    expect(data.dayUse.avgValue).toBe(600);
  });
});

/* -------------------------------------------------------------------------- */

describe("occupancy", () => {
  it("is booked days over every day the rest houses could have sold", async () => {
    const { owner } = await createOwner({ email: "occ@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    await sell(listing.id, addDays(today, -9), 6);

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    expect(data.bookedDays).toBe(6);
    expect(data.capacityDays).toBe(30);
    expect(data.kpis.occupancyPct).toBe(20);
  });

  /**
   * A night sold on Airbnb is a night this rest house is full. An owner taking
   * half their business there would otherwise watch the page call them empty.
   */
  it("counts a night imported from another platform as sold", async () => {
    const { owner } = await createOwner({ email: "ext@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    await sell(listing.id, addDays(today, -9), 3, "EXTERNAL");

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    expect(data.bookedDays).toBe(3);
  });

  /**
   * Since imported calendars arrived a row is a *reason* a day is closed rather
   * than the day itself. Counting rows would let occupancy exceed 100%.
   */
  it("counts a day closed by two sources once", async () => {
    const { owner } = await createOwner({ email: "dupe@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    const from = addDays(today, -9);
    await sell(listing.id, from, 3, "BOOKED");
    await sell(listing.id, from, 3, "EXTERNAL");

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    expect(data.bookedDays).toBe(3);
    expect(data.kpis.occupancyPct).toBeLessThanOrEqual(100);
  });

  it("keeps the owner's own blocks out of the sold count and in their own", async () => {
    const { owner } = await createOwner({ email: "blocked@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    await sell(listing.id, addDays(today, -9), 2, "BOOKED");
    await sell(listing.id, addDays(today, -20), 4, "BLOCKED");

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    expect(data.bookedDays).toBe(2);
    expect(data.blockedDays).toBe(4);
    // A day closed for maintenance is not demand, so it is not occupancy.
    expect(data.kpis.occupancyPct).toBe(Math.round((2 / 30) * 100));
  });

  /**
   * A day can carry a local block AND an imported booking — two rows, two
   * `sourceKey`s, one day. (It cannot carry a local BLOCKED and a local BOOKED:
   * `@@unique([listingId, date, sourceKey])` forbids that, which is why this
   * case is built from a block and a feed.)
   *
   * That day is SOLD, not closed. Counting it in both buckets would make the
   * breakdown sum to more than capacity and render "available: −3".
   */
  it("splits capacity into exactly three buckets", async () => {
    const { owner } = await createOwner({ email: "buckets@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    const from = addDays(today, -9);
    await sell(listing.id, from, 3, "BLOCKED");
    await sell(listing.id, from, 3, "EXTERNAL");
    await sell(listing.id, addDays(today, -20), 2, "BLOCKED");

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    expect(data.bookedDays).toBe(3);
    expect(data.blockedDays).toBe(2);
    expect(data.bookedDays + data.blockedDays + data.availableDays).toBe(data.capacityDays);
  });
});

/* -------------------------------------------------------------------------- */

describe("the cancellation rate", () => {
  /**
   * A REJECTED request is an owner declining an enquiry, not a booking falling
   * through. Folding the two together makes a selective owner look unreliable.
   */
  it("measures cancelled against confirmed, ignoring rejections", async () => {
    const { owner } = await createOwner({ email: "cancel@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    await booking(listing.id, { status: "CONFIRMED" });
    await booking(listing.id, { status: "CONFIRMED" });
    await booking(listing.id, { status: "CONFIRMED" });
    await booking(listing.id, { status: "CANCELLED" });
    await booking(listing.id, { status: "REJECTED" });
    await booking(listing.id, { status: "REJECTED" });

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    // 1 of 4, not 1 of 6 and not 3 of 6.
    expect(data.kpis.cancellationPct).toBe(25);
  });

  it("is null rather than zero when nothing has been answered", async () => {
    const { owner } = await createOwner({ email: "nocancel@test.ae" });
    await createListing({ ownerId: owner.id });

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    expect(data.kpis.cancellationPct).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe("scoping", () => {
  it("never shows one owner another owner's figures", async () => {
    const a = await createOwner({ email: "a@test.ae" });
    const b = await createOwner({ email: "b@test.ae" });
    const listingA = await createListing({ ownerId: a.owner.id });
    const listingB = await createListing({ ownerId: b.owner.id });

    await booking(listingA.id, { subtotal: 1_000 });
    await booking(listingB.id, { subtotal: 9_000 });
    await sell(listingB.id, addDays(today, -9), 10);

    const data = await getAnalytics({ ownerId: a.owner.id }, period30());
    expect(data.kpis.revenue).toBe(1_000);
    expect(data.bookedDays).toBe(0);
    expect(data.listings).toHaveLength(1);
  });

  /**
   * The property the CSV export depends on: `listingId` is ANDed with
   * `ownerId`, never swapped for it. A hand-edited query string can only narrow
   * what an owner sees.
   */
  it("returns nothing when an owner asks for a rest house that is not theirs", async () => {
    const a = await createOwner({ email: "scope-a@test.ae" });
    const b = await createOwner({ email: "scope-b@test.ae" });
    const listingB = await createListing({ ownerId: b.owner.id });
    await createListing({ ownerId: a.owner.id });
    await booking(listingB.id, { subtotal: 9_000 });

    const data = await getAnalytics(
      { ownerId: a.owner.id, listingId: listingB.id },
      period30(),
    );
    expect(data.kpis.revenue).toBe(0);
    expect(data.listingCount).toBe(0);
    expect(data.listings).toHaveLength(0);
  });

  it("narrows the operator's view to one rest house when asked", async () => {
    const { owner } = await createOwner({ email: "admin-scope@test.ae" });
    const one = await createListing({ ownerId: owner.id, name: "One" });
    const two = await createListing({ ownerId: owner.id, name: "Two" });
    await booking(one.id, { subtotal: 1_000 });
    await booking(two.id, { subtotal: 4_000 });

    // No ownerId: the operator sees the whole platform.
    const all = await getAnalytics({}, period30());
    expect(all.kpis.revenue).toBe(5_000);

    const justTwo = await getAnalytics({ listingId: two.id }, period30());
    expect(justTwo.kpis.revenue).toBe(4_000);
    expect(justTwo.listingCount).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */

describe("the weekend", () => {
  /**
   * Weekend-ness is a property of a (listing, day) pair. An owner may run a
   * Sharjah rest house whose weekend is three days long alongside a Dubai one
   * whose weekend is two, and a single national constant would misreport both.
   */
  it("uses each rest house's own weekend", async () => {
    const { owner } = await createOwner({ email: "weekend@test.ae" });
    const short = await createListing({ ownerId: owner.id, weekendMode: "short" });
    const long = await createListing({ ownerId: owner.id, weekendMode: "long" });

    // A Sunday inside the window. Sunday is the ONLY day the two modes disagree
    // about, so a case built around Friday would prove nothing.
    let sunday = addDays(today, -7);
    while (new Date(`${sunday}T00:00:00Z`).getUTCDay() !== 0) {
      sunday = addDays(sunday, 1);
    }

    await sell(short.id, sunday, 1);
    await sell(long.id, sunday, 1);

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    // One of the two Sundays is a weekend day, the other a weekday.
    expect(data.weekendOccupancyPct).toBeGreaterThan(0);
    expect(data.weekdayOccupancyPct).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("the trend", () => {
  it("bars sum to the headline revenue", async () => {
    const { owner } = await createOwner({ email: "trend@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    await booking(listing.id, { checkIn: addDays(today, -3), subtotal: 1_000 });
    await booking(listing.id, { checkIn: addDays(today, -10), subtotal: 2_000 });

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    const charted = data.trend.reduce((total, point) => total + point.revenue, 0);
    // A chart that does not add up to the tile above it is the page arguing
    // with itself.
    expect(charted).toBe(data.kpis.revenue);
  });

  it("keeps empty buckets, so a gap does not read as continuity", async () => {
    const { owner } = await createOwner({ email: "gaps@test.ae" });
    await createListing({ ownerId: owner.id });

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    expect(data.bucket).toBe("day");
    expect(data.trend).toHaveLength(30);
  });

  it("widens the bucket as the period grows", async () => {
    const { owner } = await createOwner({ email: "buckets2@test.ae" });
    await createListing({ ownerId: owner.id });

    for (const [period, bucket] of [
      ["7d", "day"],
      ["30d", "day"],
      ["3m", "week"],
      ["6m", "month"],
      ["1y", "month"],
    ] as const) {
      const data = await getAnalytics(
        { ownerId: owner.id },
        resolvePeriod({ period }, today),
      );
      expect(data.bucket).toBe(bucket);
      // Never so many marks that a phone cannot draw them.
      expect(data.trend.length).toBeLessThanOrEqual(31);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("booking sources", () => {
  /**
   * An iCal feed carries dates and no prices. Reporting a revenue for those
   * days would be a guess presented as a measurement, so they are counted
   * separately as days whose money is not known.
   */
  it("separates recorded bookings from imported days with nothing behind them", async () => {
    const { owner } = await createOwner({ email: "source@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    const feed = await prisma.calendarFeed.create({
      data: { listingId: listing.id, platform: "AIRBNB", url: "https://example.com/a.ics" },
    });

    await booking(listing.id, { checkIn: addDays(today, -5), nights: 2, subtotal: 1_000 });

    for (let i = 0; i < 4; i++) {
      await prisma.availability.create({
        data: {
          listingId: listing.id,
          date: addDays(today, -20 + i),
          status: "EXTERNAL",
          sourceKey: feed.id,
          feedId: feed.id,
        },
      });
    }

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    const rihla = data.sources.find((s) => s.key === "RIHLA");
    const airbnb = data.sources.find((s) => s.key === "AIRBNB");

    // A booking with no source column set is one the public flow took.
    expect(rihla?.bookings).toBe(1);
    expect(rihla?.revenue).toBe(1_000);
    expect(rihla?.days).toBe(2);
    expect(rihla?.unrecordedDays).toBe(0);

    // Four days closed by the feed, none of them recorded.
    expect(airbnb?.bookings).toBe(0);
    expect(airbnb?.revenue).toBe(0);
    expect(airbnb?.unrecordedDays).toBe(4);
  });

  /**
   * The payoff of the source column: an owner who records what Airbnb paid gets
   * a revenue figure where there used to be only a night count, and the days
   * that booking covers stop being reported as unaccounted for.
   */
  it("reports revenue for an imported platform once its booking is recorded", async () => {
    const { owner } = await createOwner({ email: "recorded@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    const feed = await prisma.calendarFeed.create({
      data: { listingId: listing.id, platform: "AIRBNB", url: "https://example.com/a.ics" },
    });

    const checkIn = addDays(today, -8);
    await booking(listing.id, { checkIn, nights: 3, subtotal: 5_200, source: "AIRBNB" });
    // The feed had already closed the same three days.
    for (let i = 0; i < 3; i++) {
      await prisma.availability.create({
        data: {
          listingId: listing.id,
          date: addDays(checkIn, i),
          status: "EXTERNAL",
          sourceKey: feed.id,
          feedId: feed.id,
        },
      });
    }

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    const airbnb = data.sources.find((s) => s.key === "AIRBNB");

    expect(airbnb?.bookings).toBe(1);
    expect(airbnb?.revenue).toBe(5_200);
    expect(airbnb?.days).toBe(3);
    // Those feed days now have a booking behind them, so none are unaccounted.
    expect(airbnb?.unrecordedDays).toBe(0);
  });

  it("gives a direct booking its own row", async () => {
    const { owner } = await createOwner({ email: "direct@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    await booking(listing.id, { subtotal: 2_400, source: "DIRECT" });

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    const direct = data.sources.find((s) => s.key === "DIRECT");

    expect(direct?.bookings).toBe(1);
    expect(direct?.revenue).toBe(2_400);
    // And it does not leak into the platform's own row.
    expect(data.sources.find((s) => s.key === "RIHLA")).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */

describe("change against the previous period", () => {
  it("offers a ratio and a difference, and no ratio to grow from nothing", () => {
    expect(change(12_000, 10_000)).toEqual({ pct: 20, points: 2_000, direction: "up" });
    expect(change(60, 50)).toEqual({ pct: 20, points: 10, direction: "up" });
    // Occupancy 50% → 60% is +10 points; the caller reads `points`, not `pct`.
    expect(change(8, 10).direction).toBe("down");
    expect(change(5, 5).direction).toBe("flat");
    // Nothing to be a percentage of.
    expect(change(500, 0).pct).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe("the export", () => {
  it("writes figures as numbers, so Excel can sum them", async () => {
    const { owner } = await createOwner({ email: "csv@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    await booking(listing.id, { subtotal: 1_800 });

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    const sheet = readSheet(analyticsWorkbook(data, ar, "ar", "كل الاستراحات"));

    const revenue = rowOf(sheet, ar.analytics.revenue);
    expect(revenue[1]).toMatchObject({ kind: "number", value: "1800" });
    // "١٬٨٠٠" is a string as far as a spreadsheet is concerned: unsortable,
    // unsummable, and the export exists so those things can be done.
    expect(sheet.xml).not.toContain("١٬٨٠٠");
  });

  it("is a workbook Excel opens, with the Arabic intact", async () => {
    const { owner } = await createOwner({ email: "csv2@test.ae" });
    await createListing({ ownerId: owner.id });

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    const workbook = analyticsWorkbook(data, ar, "ar", "كل الاستراحات");
    const sheet = readSheet(workbook);

    expect(analyticsFilename(data).endsWith(".xlsx")).toBe(true);
    // A zip, whose first part is the one naming all the others. `readSheet`
    // verifies every CRC on the way in.
    expect([...workbook.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(sheet.parts).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]);

    // The whole reason this is not a CSV: the headings arrive as Arabic rather
    // than as "Ø§Ù„...", because the part states its own encoding and nothing
    // downstream has to guess it.
    expect(cellAt(sheet, "A1")?.value).toBe(ar.analytics.title);
    expect(cellAt(sheet, "B1")?.value).toBe("كل الاستراحات");
    expect(rowOf(sheet, ar.analytics.netRevenue)[0].value).toBe(ar.analytics.netRevenue);
    // Arabic reads right to left, and so does the sheet.
    expect(sheet.rightToLeft).toBe(true);

    // The period is a real date — a serial carrying a date format — and not the
    // text "2026-08-13", which nothing could plot against time.
    const period = rowOf(sheet, ar.analytics.period);
    expect(period[1].kind).toBe("number");
    expect(period[1].style).toBe(2);
  });

  it("hands the workbook to the browser as bytes, unmangled", async () => {
    const { owner } = await createOwner({ email: "csv4@test.ae" });
    await createListing({ ownerId: owner.id });

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    const workbook = analyticsWorkbook(data, ar, "ar", "كل الاستراحات");
    const response = workbookResponse(workbook, analyticsFilename(data));

    // The generator is tested above; this is the step that turns it into a
    // download, and a binary body is exactly the kind that arrives re-encoded,
    // truncated or declared as something a browser tries to render.
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.length).toBe(workbook.length);
    expect(readSheet(body).name).toBe(ar.analytics.title);
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("Content-Disposition")).toContain(".xlsx");
  });

  it("leaves the imported platforms' revenue blank rather than zero", async () => {
    const { owner } = await createOwner({ email: "csv3@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    const feed = await prisma.calendarFeed.create({
      data: { listingId: listing.id, platform: "BOOKING", url: "https://example.com/b.ics" },
    });
    await prisma.availability.create({
      data: {
        listingId: listing.id,
        date: addDays(today, -3),
        status: "EXTERNAL",
        sourceKey: feed.id,
        feedId: feed.id,
      },
    });

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    const sheet = readSheet(analyticsWorkbook(data, ar, "ar", "كل الاستراحات"));

    // Columns are: source, recorded days, bookings, revenue, imported days.
    // The word rather than a 0 in the revenue cell — a 0 would sum into a total
    // and quietly claim the platform earned nothing, which is a different
    // statement from "we cannot know".
    const row = rowOf(sheet, "Booking.com");
    expect(row.map((cell) => cell.value)).toEqual([
      "Booking.com",
      "0",
      "0",
      ar.analytics.revenueUnknown,
      "1",
    ]);
    expect(row[3].kind).toBe("text");
  });
});

/* -------------------------------------------------------------------------- */

describe("an empty scope", () => {
  it("reports zeroes rather than throwing or inventing a figure", async () => {
    const { owner } = await createOwner({ email: "empty@test.ae" });

    const data = await getAnalytics({ ownerId: owner.id }, period30());
    expect(data.listingCount).toBe(0);
    expect(data.kpis.revenue).toBe(0);
    expect(data.kpis.occupancyPct).toBe(0);
    expect(data.kpis.avgDailyRate).toBeNull();
    expect(data.alerts.map((a) => a.key)).toEqual(["noData"]);
  });
});
