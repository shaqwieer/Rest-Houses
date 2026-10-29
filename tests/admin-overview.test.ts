import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { createListing, ensureSchema, prisma, resetDatabase, seedSettings } from "./db";
import {
  confirmedBookingCounts,
  freezeClosedMonths,
  monthPerformance,
  monthlyRecord,
  type MonthRecord,
} from "@/lib/admin-queries";
import { addDays, monthRange, todayISO } from "@/lib/dates";

/**
 * The admin overview's booking figures: tiles 7 and 9 (confirmed bookings, and
 * the ones still being worked), and 10–17 (one calendar month's bookings, what
 * they are worth, and which rest house is carrying it).
 *
 * The operator's two complaints about the figures these replaced are the two
 * things worth pinning down:
 *
 *  • bookings recorded as «حجز خارجي» (WhatsApp, Airbnb, Booking.com) are not
 *    the platform's business and must not be counted, in any tile
 *  • a month's figure must not drift as its days go by — a stay that has
 *    already happened is still this month's revenue
 */

beforeAll(() => {
  ensureSchema();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await seedSettings();
});

const thisMonth = monthRange(todayISO());
const nextMonth = monthRange(todayISO(), 1);

async function booking(
  listingId: string,
  opts: {
    checkIn: string;
    total: number;
    status?: string;
    source?: string;
    stage?: string;
  },
) {
  return prisma.bookingRequest.create({
    data: {
      reference: `RQ-${Math.floor(Math.random() * 1_000_000)}-${Date.now()}`,
      listingId,
      customerName: "Guest",
      customerPhone: "+971501111111",
      checkIn: opts.checkIn,
      checkOut: addDays(opts.checkIn, 1),
      nights: 1,
      guests: 10,
      subtotal: opts.total,
      serviceFee: 0,
      total: opts.total,
      depositDue: 0,
      depositPercent: 0,
      status: opts.status ?? "CONFIRMED",
      source: opts.source ?? "RIHLA",
      ...(opts.stage ? { stage: opts.stage } : {}),
    },
  });
}

describe("confirmedBookingCounts", () => {
  it("counts confirmed platform bookings, and the ones still being worked", async () => {
    const listing = await createListing();

    await booking(listing.id, { checkIn: thisMonth.from, total: 1_000 });
    await booking(listing.id, { checkIn: thisMonth.from, total: 1_000, stage: "DONE" });

    expect(await confirmedBookingCounts()).toEqual({ all: 2, inProgress: 1 });
  });

  it("leaves every booking recorded from outside the platform out of both", async () => {
    const listing = await createListing();

    await booking(listing.id, { checkIn: thisMonth.from, total: 1_000 });
    for (const source of ["DIRECT", "AIRBNB", "BOOKING", "OTHER"]) {
      // One still in progress and one finished from each, so neither tile can
      // pass by excluding only one stage.
      await booking(listing.id, { checkIn: thisMonth.from, total: 1_000, source });
      await booking(listing.id, { checkIn: thisMonth.from, total: 1_000, source, stage: "DONE" });
    }

    expect(await confirmedBookingCounts()).toEqual({ all: 1, inProgress: 1 });
  });

  it("counts only confirmed bookings", async () => {
    const listing = await createListing();

    for (const status of ["NEW", "REJECTED", "CANCELLED"]) {
      await booking(listing.id, { checkIn: thisMonth.from, total: 1_000, status });
    }

    expect(await confirmedBookingCounts()).toEqual({ all: 0, inProgress: 0 });
  });
});

describe("monthPerformance", () => {
  it("counts confirmed platform bookings that start in the month, and sums their value", async () => {
    const a = await createListing({ name: "A" });
    const b = await createListing({ name: "B" });

    await booking(a.id, { checkIn: thisMonth.from, total: 1_000 });
    await booking(a.id, { checkIn: addDays(thisMonth.from, 10), total: 2_000 });
    await booking(b.id, { checkIn: addDays(thisMonth.from, 5), total: 4_500 });

    const month = await monthPerformance(thisMonth);

    expect(month.bookings).toBe(3);
    expect(month.revenue).toBe(7_500);
    expect(month.topByRevenue).toMatchObject({ id: b.id, value: 4_500 });
    expect(month.topByBookings).toMatchObject({ id: a.id, value: 2 });
  });

  it("leaves every booking recorded from outside the platform out of every figure", async () => {
    const rihla = await createListing({ name: "Rihla" });
    const busyElsewhere = await createListing({ name: "Busy elsewhere" });

    await booking(rihla.id, { checkIn: thisMonth.from, total: 1_000 });
    for (const source of ["DIRECT", "AIRBNB", "BOOKING", "OTHER"]) {
      await booking(busyElsewhere.id, { checkIn: thisMonth.from, total: 50_000, source });
    }

    const month = await monthPerformance(thisMonth);

    expect(month.bookings).toBe(1);
    expect(month.revenue).toBe(1_000);
    // The listing with four large external bookings must not top either list.
    expect(month.topByRevenue?.id).toBe(rihla.id);
    expect(month.topByBookings?.id).toBe(rihla.id);
  });

  it("counts only confirmed bookings", async () => {
    const listing = await createListing();

    await booking(listing.id, { checkIn: thisMonth.from, total: 1_000 });
    for (const status of ["NEW", "REJECTED", "CANCELLED"]) {
      await booking(listing.id, { checkIn: thisMonth.from, total: 9_000, status });
    }

    const month = await monthPerformance(thisMonth);

    expect(month.bookings).toBe(1);
    expect(month.revenue).toBe(1_000);
  });

  it("keeps a finished stay in its month, so the figure does not shrink as the days pass", async () => {
    const listing = await createListing();

    // Checked in on the 1st, handover complete. Whatever today is, this is
    // still this month's booking and this month's money.
    await booking(listing.id, { checkIn: thisMonth.from, total: 3_000, stage: "DONE" });

    const month = await monthPerformance(thisMonth);

    expect(month.bookings).toBe(1);
    expect(month.revenue).toBe(3_000);
  });

  it("does not move when a rest house is unpublished", async () => {
    const listing = await createListing({ published: false });

    await booking(listing.id, { checkIn: thisMonth.from, total: 2_000 });

    const month = await monthPerformance(thisMonth);

    expect(month.bookings).toBe(1);
    expect(month.revenue).toBe(2_000);
  });

  it("files a booking under the month its stay starts in", async () => {
    const listing = await createListing();

    // The last night of this month, leaving on the 1st of the next.
    await booking(listing.id, { checkIn: addDays(thisMonth.to, -1), total: 1_000 });
    await booking(listing.id, { checkIn: nextMonth.from, total: 4_000 });

    const [current, ahead] = await Promise.all([
      monthPerformance(thisMonth),
      monthPerformance(nextMonth),
    ]);

    expect(current).toMatchObject({ bookings: 1, revenue: 1_000 });
    expect(ahead).toMatchObject({ bookings: 1, revenue: 4_000 });
  });

  it("reports nothing — not an arbitrary winner — for an empty month", async () => {
    await createListing();

    const month = await monthPerformance(thisMonth);

    expect(month).toMatchObject({
      bookings: 0,
      revenue: 0,
      topByRevenue: null,
      topByBookings: null,
    });
  });
});

describe("monthlyRecord", () => {
  // A fixed "today", so which months are settled does not depend on the day
  // the suite runs: September is last month, November the next.
  const today = "2026-10-30";

  /** The record as plain rows, newest first, the way the page lists it. */
  async function record(on = today) {
    return (await monthlyRecord(on)).map((r: MonthRecord) => ({
      month: r.range.from.slice(0, 7),
      bookings: r.bookings,
      revenue: r.revenue,
      frozen: r.frozen,
    }));
  }

  it("lists last month, this month and the next with the same figures as the overview", async () => {
    const listing = await createListing();

    await booking(listing.id, { checkIn: "2026-09-12", total: 1_200 });
    await booking(listing.id, { checkIn: "2026-10-01", total: 2_000 });
    await booking(listing.id, { checkIn: "2026-10-31", total: 3_000, stage: "DONE" });
    await booking(listing.id, { checkIn: "2026-11-05", total: 4_500 });
    // The overview leaves these out, so the record must too.
    await booking(listing.id, { checkIn: "2026-10-10", total: 9_000, source: "AIRBNB" });
    await booking(listing.id, { checkIn: "2026-10-11", total: 9_000, status: "CANCELLED" });

    const rows = await record();
    expect(rows).toEqual([
      { month: "2026-11", bookings: 1, revenue: 4_500, frozen: false },
      { month: "2026-10", bookings: 2, revenue: 5_000, frozen: false },
      { month: "2026-09", bookings: 1, revenue: 1_200, frozen: false },
    ]);

    for (const offset of [-1, 0, 1]) {
      const range = monthRange(today, offset);
      const tile = await monthPerformance(range);
      const row = rows.find((r) => r.month === range.from.slice(0, 7));
      expect(row).toMatchObject({ bookings: tile.bookings, revenue: tile.revenue });
    }
  });

  it("keeps a settled month when the rest house it was booked at is deleted", async () => {
    const listing = await createListing();

    await booking(listing.id, { checkIn: "2026-07-20", total: 6_000 });
    await booking(listing.id, { checkIn: "2026-10-20", total: 2_500 });
    await record();

    // Deleting a listing takes its bookings with it (onDelete: Cascade).
    await prisma.listing.delete({ where: { id: listing.id } });

    const rows = await record();
    expect(rows.find((r) => r.month === "2026-07")).toEqual({
      month: "2026-07",
      bookings: 1,
      revenue: 6_000,
      frozen: true,
    });
    // A month still live follows its bookings.
    expect(rows.find((r) => r.month === "2026-10")).toMatchObject({ bookings: 0, revenue: 0 });
  });

  it("keeps last month live, so a cancellation in the days after it ends still reaches it", async () => {
    const listing = await createListing();
    const late = await booking(listing.id, { checkIn: "2026-09-30", total: 1_800 });

    expect((await record()).find((r) => r.month === "2026-09")).toMatchObject({
      bookings: 1,
      frozen: false,
    });

    await prisma.bookingRequest.update({ where: { id: late.id }, data: { status: "CANCELLED" } });

    expect((await record()).find((r) => r.month === "2026-09")).toMatchObject({
      bookings: 0,
      revenue: 0,
    });
  });

  it("freezes a month on the first day of the month after next, and never changes it after", async () => {
    const listing = await createListing();
    const stay = await booking(listing.id, { checkIn: "2026-10-15", total: 3_300 });

    expect((await record("2026-11-30")).find((r) => r.month === "2026-10")?.frozen).toBe(false);
    expect((await record("2026-12-01")).find((r) => r.month === "2026-10")?.frozen).toBe(true);

    await prisma.bookingRequest.update({ where: { id: stay.id }, data: { status: "CANCELLED" } });

    expect((await record("2026-12-01")).find((r) => r.month === "2026-10")).toEqual({
      month: "2026-10",
      bookings: 1,
      revenue: 3_300,
      frozen: true,
    });
  });

  it("starts at the first booking and lists every month after it, empty ones at zero", async () => {
    const listing = await createListing();
    await booking(listing.id, { checkIn: "2026-05-03", total: 900 });

    expect(await record()).toEqual([
      { month: "2026-11", bookings: 0, revenue: 0, frozen: false },
      { month: "2026-10", bookings: 0, revenue: 0, frozen: false },
      { month: "2026-09", bookings: 0, revenue: 0, frozen: false },
      { month: "2026-08", bookings: 0, revenue: 0, frozen: true },
      { month: "2026-07", bookings: 0, revenue: 0, frozen: true },
      { month: "2026-06", bookings: 0, revenue: 0, frozen: true },
      { month: "2026-05", bookings: 1, revenue: 900, frozen: true },
    ]);
  });

  it("freezes only confirmed platform bookings", async () => {
    const listing = await createListing();
    await booking(listing.id, { checkIn: "2026-06-01", total: 1_000 });
    await booking(listing.id, { checkIn: "2026-06-02", total: 8_000, source: "DIRECT" });
    await booking(listing.id, { checkIn: "2026-06-03", total: 8_000, status: "NEW" });

    expect((await record()).find((r) => r.month === "2026-06")).toEqual({
      month: "2026-06",
      bookings: 1,
      revenue: 1_000,
      frozen: true,
    });
  });

  it("reaches as far ahead as something is already booked", async () => {
    const listing = await createListing();
    await booking(listing.id, { checkIn: "2027-01-08", total: 5_000 });

    expect((await record()).map((r) => r.month)).toEqual([
      "2027-01",
      "2026-12",
      "2026-11",
      "2026-10",
      "2026-09",
    ]);
  });

  it("survives two page loads freezing the same months at once", async () => {
    const listing = await createListing();
    await booking(listing.id, { checkIn: "2026-04-10", total: 700 });

    await Promise.all([freezeClosedMonths(today), freezeClosedMonths(today)]);

    expect(await prisma.monthlyFigure.count()).toBe(5); // April to August
  });
});
