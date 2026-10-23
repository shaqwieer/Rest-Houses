import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { createListing, ensureSchema, prisma, resetDatabase, seedSettings } from "./db";
import { monthPerformance } from "@/lib/admin-queries";
import { addDays, monthRange, todayISO } from "@/lib/dates";

/**
 * Tiles 10–17 of the admin overview: one calendar month's bookings, what they
 * are worth, and which rest house is carrying it.
 *
 * The operator's two complaints about the figures this replaced are the two
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
