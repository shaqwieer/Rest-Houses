import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { createListing, createOwner, ensureSchema, prisma, resetDatabase, seedSettings } from "./db";
import { getOwnerInsights } from "@/lib/owner-insights";
import { addDays, todayISO } from "@/lib/dates";

/**
 * Requirement 9: the owner dashboard reports how a rest house is actually
 * performing.
 *
 * The assertions that matter here are the *definitions*, not the arithmetic —
 * what counts as earnings, what occupancy is a fraction of, which requests the
 * confirmation rate is measured against. Those are the things a future change
 * can quietly get wrong while every number still looks plausible on screen.
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

async function booking(
  listingId: string,
  opts: {
    status?: string;
    checkIn?: string;
    nights?: number;
    subtotal?: number;
    serviceFee?: number;
    guests?: number;
    phone?: string;
    createdAt?: Date;
  } = {},
) {
  const checkIn = opts.checkIn ?? addDays(today, 5);
  const nights = opts.nights ?? 2;
  const subtotal = opts.subtotal ?? 1000;
  const serviceFee = opts.serviceFee ?? 100;

  return prisma.bookingRequest.create({
    data: {
      reference: `RQ-${Math.floor(Math.random() * 1_000_000)}-${Date.now()}`,
      listingId,
      customerName: "Guest",
      customerPhone: opts.phone ?? "+971501111111",
      checkIn,
      checkOut: addDays(checkIn, nights),
      nights,
      guests: opts.guests ?? 10,
      subtotal,
      serviceFee,
      total: subtotal + serviceFee,
      depositDue: 0,
      depositPercent: 0,
      status: opts.status ?? "CONFIRMED",
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
}

/** Mark a stay's nights BOOKED, the way confirming a request does. */
async function blockNights(listingId: string, checkIn: string, nights: number) {
  for (let i = 0; i < nights; i++) {
    await prisma.availability.create({
      data: { listingId, date: addDays(checkIn, i), status: "BOOKED" },
    });
  }
}

describe("what counts as earnings", () => {
  /**
   * `total` includes the platform's service fee, which is not the owner's money.
   * A dashboard that reports it as earnings overstates what the owner takes home
   * by exactly the fee percentage.
   */
  it("reports the subtotal, never the total the guest paid", async () => {
    const { owner } = await createOwner({ email: "earn@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    await booking(listing.id, { subtotal: 2_000, serviceFee: 200 });

    const insights = await getOwnerInsights(owner.id);

    expect(insights.earningsAhead).toBe(2_000);
    expect(insights.earningsInWindow).toBe(2_000);
    expect(insights.avgBookingValue).toBe(2_000);
  });

  it("counts only confirmed bookings as earnings", async () => {
    const { owner } = await createOwner({ email: "earn2@test.ae" });
    const listing = await createListing({ ownerId: owner.id });

    await booking(listing.id, { status: "CONFIRMED", subtotal: 1_000 });
    await booking(listing.id, { status: "NEW", subtotal: 5_000, checkIn: addDays(today, 8) });
    await booking(listing.id, { status: "REJECTED", subtotal: 9_000, checkIn: addDays(today, 11) });

    const insights = await getOwnerInsights(owner.id);
    expect(insights.earningsAhead).toBe(1_000);
  });
});

describe("occupancy", () => {
  /**
   * Numerator and denominator must be scoped the same way. Counting an
   * unpublished listing's booked nights while leaving it out of the capacity is
   * how an occupancy figure quietly climbs past 100%.
   */
  it("excludes an unpublished listing from both the nights and the capacity", async () => {
    const { owner } = await createOwner({ email: "occ@test.ae" });
    const live = await createListing({ ownerId: owner.id, published: true });
    const hidden = await createListing({ ownerId: owner.id, published: false });

    await blockNights(live.id, today, 15);
    await blockNights(hidden.id, today, 30);

    const insights = await getOwnerInsights(owner.id);

    // 15 nights out of one published listing × 30 days.
    expect(insights.capacityNightsAhead).toBe(30);
    expect(insights.bookedNightsAhead).toBe(15);
    expect(insights.occupancyPct).toBe(50);
    expect(insights.occupancyPct).toBeLessThanOrEqual(100);
  });

  it("is zero, not a division by zero, when nothing is published", async () => {
    const { owner } = await createOwner({ email: "occ2@test.ae" });
    await createListing({ ownerId: owner.id, published: false });

    const insights = await getOwnerInsights(owner.id);
    expect(insights.occupancyPct).toBe(0);
    expect(Number.isFinite(insights.occupancyPct)).toBe(true);
  });

  it("ignores nights that fall outside the window", async () => {
    const { owner } = await createOwner({ email: "occ3@test.ae" });
    const listing = await createListing({ ownerId: owner.id });

    await blockNights(listing.id, today, 3);
    // Well past the 30-day horizon.
    await blockNights(listing.id, addDays(today, 60), 10);

    const insights = await getOwnerInsights(owner.id);
    expect(insights.bookedNightsAhead).toBe(3);
  });
});

describe("confirmation rate", () => {
  /**
   * Requests still sitting in the inbox have not been *answered*. Counting them
   * as failures would make a busy week look like a bad one.
   */
  it("is measured against answered requests, not every request", async () => {
    const { owner } = await createOwner({ email: "rate@test.ae" });
    const listing = await createListing({ ownerId: owner.id });

    await booking(listing.id, { status: "CONFIRMED", checkIn: addDays(today, 1) });
    await booking(listing.id, { status: "CONFIRMED", checkIn: addDays(today, 3) });
    await booking(listing.id, { status: "REJECTED", checkIn: addDays(today, 5) });
    await booking(listing.id, { status: "REJECTED", checkIn: addDays(today, 7) });
    // Three still pending — they must not drag the rate down.
    await booking(listing.id, { status: "NEW", checkIn: addDays(today, 9) });
    await booking(listing.id, { status: "NEW", checkIn: addDays(today, 12) });
    await booking(listing.id, { status: "NEW", checkIn: addDays(today, 14) });

    const insights = await getOwnerInsights(owner.id);
    expect(insights.confirmationRate).toBe(50);
  });

  it("is null rather than zero when nothing has been answered yet", async () => {
    const { owner } = await createOwner({ email: "rate2@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    await booking(listing.id, { status: "NEW" });

    const insights = await getOwnerInsights(owner.id);
    expect(insights.confirmationRate).toBeNull();
  });
});

describe("the monthly trend", () => {
  it("buckets a stay by the month it starts in, and spans six months", async () => {
    const { owner } = await createOwner({ email: "trend@test.ae" });
    const listing = await createListing({ ownerId: owner.id });

    await booking(listing.id, { checkIn: today, subtotal: 700 });

    const insights = await getOwnerInsights(owner.id);
    expect(insights.trend).toHaveLength(6);

    const thisMonth = insights.trend[insights.trend.length - 1];
    expect(thisMonth.key).toBe(today.slice(0, 7));
    expect(thisMonth.earnings).toBe(700);
    expect(thisMonth.confirmed).toBe(1);

    // Every other bucket stays empty rather than absent, so the chart has a bar
    // for every month whether or not anything happened in it.
    const earlier = insights.trend.slice(0, -1);
    expect(earlier.every((p) => p.earnings === 0)).toBe(true);
  });
});

describe("demand patterns", () => {
  it("averages nights, guests and lead time over confirmed bookings", async () => {
    const { owner } = await createOwner({ email: "pat@test.ae" });
    const listing = await createListing({ ownerId: owner.id });

    // Requested 10 days before a stay that starts in 10 days.
    await booking(listing.id, {
      checkIn: addDays(today, 10),
      nights: 4,
      guests: 20,
      createdAt: new Date(),
    });

    const insights = await getOwnerInsights(owner.id);
    expect(insights.avgNights).toBe(4);
    expect(insights.avgGuests).toBe(20);
    expect(insights.avgLeadTimeDays).toBe(10);
  });

  it("keeps a half-night in the average rather than rounding it away", async () => {
    const { owner } = await createOwner({ email: "half@test.ae" });
    const listing = await createListing({ ownerId: owner.id });

    await booking(listing.id, { nights: 2, checkIn: addDays(today, 2) });
    await booking(listing.id, { nights: 3, checkIn: addDays(today, 12) });

    const insights = await getOwnerInsights(owner.id);
    expect(insights.avgNights).toBe(2.5);
  });

  it("counts a returning phone number as a repeat guest", async () => {
    const { owner } = await createOwner({ email: "rep@test.ae" });
    const listing = await createListing({ ownerId: owner.id });

    await booking(listing.id, { phone: "+971 50 111 1111", checkIn: addDays(today, 2) });
    // The same number written differently — the digits are what identify a guest.
    await booking(listing.id, { phone: "0501111111", checkIn: addDays(today, 20) });
    await booking(listing.id, { phone: "+971502222222", checkIn: addDays(today, 25) });

    const insights = await getOwnerInsights(owner.id);
    expect(insights.repeatGuests).toBe(1);
  });

  it("leaves every average null when there is nothing confirmed yet", async () => {
    const { owner } = await createOwner({ email: "empty@test.ae" });
    await createListing({ ownerId: owner.id });

    const insights = await getOwnerInsights(owner.id);
    expect(insights.avgBookingValue).toBeNull();
    expect(insights.avgNights).toBeNull();
    expect(insights.avgLeadTimeDays).toBeNull();
    expect(insights.weekendSharePct).toBeNull();
  });
});

describe("advice", () => {
  it("flags requests that have been waiting more than a day", async () => {
    const { owner } = await createOwner({ email: "adv@test.ae" });
    const listing = await createListing({ ownerId: owner.id });

    await booking(listing.id, {
      status: "NEW",
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });
    await booking(listing.id, { status: "NEW", checkIn: addDays(today, 9), createdAt: new Date() });

    const insights = await getOwnerInsights(owner.id);
    expect(insights.unanswered).toBe(1);
    expect(insights.insights.some((i) => i.key === "unanswered")).toBe(true);
  });

  it("says nothing about unanswered requests when the inbox is current", async () => {
    const { owner } = await createOwner({ email: "adv2@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    await booking(listing.id, { status: "NEW", createdAt: new Date() });

    const insights = await getOwnerInsights(owner.id);
    expect(insights.unanswered).toBe(0);
    expect(insights.insights.some((i) => i.key === "unanswered")).toBe(false);
  });

  /**
   * "No requests" is only advice once a listing has had the chance to get some.
   * A rest house published this morning must not be told to rework its photos.
   */
  it("stays quiet about a listing that has only just been published", async () => {
    const { owner } = await createOwner({ email: "fresh@test.ae" });
    await createListing({ ownerId: owner.id, name: "Brand New" });

    const insights = await getOwnerInsights(owner.id);
    expect(insights.insights.some((i) => i.key === "quietListing")).toBe(false);
  });

  it("does flag a listing that has been up a month with nothing to show", async () => {
    const { owner } = await createOwner({ email: "stale@test.ae" });
    const listing = await createListing({ ownerId: owner.id, name: "Quiet One" });
    await prisma.listing.update({
      where: { id: listing.id },
      data: { createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
    });

    const insights = await getOwnerInsights(owner.id);
    const quiet = insights.insights.find((i) => i.key === "quietListing");
    expect(quiet?.value).toBe("Quiet One");
  });

  it("tells a new owner to add their first rest house", async () => {
    const { owner } = await createOwner({ email: "adv3@test.ae" });
    const insights = await getOwnerInsights(owner.id);
    expect(insights.insights.some((i) => i.key === "noListings")).toBe(true);
  });
});

describe("scoping", () => {
  /**
   * The invariant the whole dashboard rests on. Every query in the module is
   * filtered by ownerId in the WHERE clause rather than after the fact.
   */
  it("never reports another owner's bookings, earnings or listings", async () => {
    const mine = await createOwner({ email: "mine@test.ae" });
    const theirs = await createOwner({ email: "theirs@test.ae" });

    const myListing = await createListing({ ownerId: mine.owner.id });
    const theirListing = await createListing({ ownerId: theirs.owner.id });

    await booking(myListing.id, { subtotal: 100 });
    await booking(theirListing.id, { subtotal: 99_000 });
    await blockNights(theirListing.id, today, 30);

    const insights = await getOwnerInsights(mine.owner.id);

    expect(insights.earningsAhead).toBe(100);
    expect(insights.listings).toHaveLength(1);
    expect(insights.listings[0].id).toBe(myListing.id);
    expect(insights.bookedNightsAhead).toBe(0);
  });

  it("does not count a platform-owned listing as anybody's", async () => {
    const { owner } = await createOwner({ email: "plat@test.ae" });
    const platform = await createListing({ ownerId: null });
    await booking(platform.id, { subtotal: 4_000 });

    const insights = await getOwnerInsights(owner.id);
    expect(insights.listings).toHaveLength(0);
    expect(insights.earningsAhead).toBe(0);
  });
});

describe("per-listing performance", () => {
  it("ranks by earnings and reports each listing's own occupancy", async () => {
    const { owner } = await createOwner({ email: "rank@test.ae" });
    const quiet = await createListing({ ownerId: owner.id, name: "Quiet" });
    const busy = await createListing({ ownerId: owner.id, name: "Busy" });

    await booking(busy.id, { subtotal: 5_000 });
    await blockNights(busy.id, today, 15);
    await booking(quiet.id, { subtotal: 500, checkIn: addDays(today, 20) });

    const insights = await getOwnerInsights(owner.id);

    expect(insights.listings.map((l) => l.name)).toEqual(["Busy", "Quiet"]);
    expect(insights.listings[0].earnings).toBe(5_000);
    // 15 nights of the 30-day window for this one listing.
    expect(insights.listings[0].occupancyPct).toBe(50);
    expect(insights.listings[1].occupancyPct).toBe(0);
  });
});
