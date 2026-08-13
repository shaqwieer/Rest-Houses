import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import {
  createListing,
  createOwner,
  ensureSchema,
  prisma,
  resetDatabase,
  seedSettings,
} from "./db";
import { addDays, todayISO } from "@/lib/dates";

/**
 * Recording a booking taken somewhere else.
 *
 * What is worth asserting is the handful of decisions this path makes that no
 * other path does — because they are the ones a later change could quietly get
 * wrong while the form still appears to work:
 *
 *  • the amount is TYPED, not computed, and no commission is taken on it
 *  • a future stay closes its days; a stay wholly in the past does not
 *  • the stage follows the same split, so backfilled history does not pile up
 *    in the owner's never-paged work queue
 *  • an owner cannot record a booking against somebody else's rest house
 *
 * ─── How the session is faked ────────────────────────────────────────────────
 * Only NextAuth's `auth()` is mocked. `authorizeListing` and the guards beneath
 * it run for real, including their database reads — the scoping is the thing
 * being tested and mocking the guard would test nothing. Same arrangement as
 * tests/owner-workflow.test.ts.
 */

const sessionUser = vi.hoisted(() => ({ current: null as { id: string } | null }));

vi.mock("next-auth", async () => {
  return {
    default: () => ({
      handlers: {},
      signIn: vi.fn(),
      signOut: vi.fn(),
      auth: async () => (sessionUser.current ? { user: { id: sessionUser.current.id } } : null),
    }),
    AuthError: class AuthError extends Error {},
  };
});

vi.mock("next-auth/providers/credentials", () => ({ default: () => ({}) }));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/i18n/server", async () => {
  const { ar } = await import("@/lib/i18n/ar");
  return {
    getLocale: async () => "ar",
    getT: async () => ar,
    getDir: async () => "rtl",
    getI18n: async () => ({ locale: "ar", t: ar, dir: "rtl" }),
  };
});

const { recordBooking } = await import("@/app/actions/manual-booking");

function signInAs(userId: string | null) {
  sessionUser.current = userId ? { id: userId } : null;
}

beforeAll(() => {
  ensureSchema();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await seedSettings();
  signInAs(null);
});

const today = todayISO();

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

/** The happy-path payload, with anything the case cares about overridden. */
function payload(listingId: string, overrides: Record<string, string> = {}) {
  return form({
    listingId,
    source: "DIRECT",
    customerName: "ضيف",
    customerPhone: "+971501234567",
    checkIn: addDays(today, 5),
    checkOut: addDays(today, 7),
    guests: "6",
    amount: "3000",
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */

describe("what gets written", () => {
  it("stores the amount the owner typed, with no commission on it", async () => {
    const { owner, user } = await createOwner({ email: "rec@test.ae" });
    const listing = await createListing({ ownerId: owner.id, pricePerNight: 9_999 });
    signInAs(user.id);

    const result = await recordBooking(payload(listing.id, { amount: "3000" }));
    expect(result.ok).toBe(true);

    const booking = await prisma.bookingRequest.findFirst({
      where: { listingId: listing.id },
    });

    // Not 9,999 × 2 nights: this platform's price list has nothing to say about
    // what another channel paid out. The typed figure is the figure.
    expect(booking?.subtotal).toBe(3000);
    expect(booking?.total).toBe(3000);
    expect(booking?.serviceFee).toBe(0);
    // The platform did not produce this booking, so it is owed nothing on it.
    expect(booking?.commissionDue).toBe(0);
    expect(booking?.commissionPercent).toBe(0);
    expect(booking?.source).toBe("DIRECT");
    expect(booking?.status).toBe("CONFIRMED");
  });

  it("counts towards the listing's public booking figure", async () => {
    const { owner, user } = await createOwner({ email: "count@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    signInAs(user.id);

    await recordBooking(payload(listing.id));

    // Cancelling later decrements unconditionally, so a create that skipped
    // this would drive the public "past bookings" figure below zero.
    const after = await prisma.listing.findUnique({ where: { id: listing.id } });
    expect(after?.bookingsCount).toBe(1);
  });

  it("writes an audit row naming the source and the amount", async () => {
    const { owner, user } = await createOwner({ email: "audit@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    signInAs(user.id);

    await recordBooking(payload(listing.id, { source: "AIRBNB", amount: "4500" }));

    const entry = await prisma.auditLog.findFirst({ where: { action: "BOOKING_RECORDED" } });
    expect(entry).not.toBeNull();
    // A human stated this figure; who and what has to be recoverable.
    expect(entry?.metadata).toContain("AIRBNB");
    expect(entry?.metadata).toContain("4500");
  });

  it("records a day-use stay as one day, not one night", async () => {
    const { owner, user } = await createOwner({ email: "day@test.ae" });
    const listing = await createListing({ ownerId: owner.id, dayUsePrice: 700 });
    signInAs(user.id);

    const day = addDays(today, 4);
    const result = await recordBooking(
      payload(listing.id, { dayUse: "on", checkIn: day, checkOut: "", amount: "700" }),
    );
    expect(result.ok).toBe(true);

    const booking = await prisma.bookingRequest.findFirst({ where: { listingId: listing.id } });
    // `checkOut === checkIn` and `nights === 0` are the literal truth — see the
    // note on `BookingRequest.dayUse` in prisma/schema.prisma.
    expect(booking?.dayUse).toBe(true);
    expect(booking?.nights).toBe(0);
    expect(booking?.checkOut).toBe(day);

    // And it still takes the day off the market, which `nightsInRange` alone
    // would not have done.
    const days = await prisma.availability.findMany({ where: { listingId: listing.id } });
    expect(days.map((d) => d.date)).toEqual([day]);
  });
});

/* -------------------------------------------------------------------------- */

describe("the calendar", () => {
  it("closes the days of a future stay", async () => {
    const { owner, user } = await createOwner({ email: "future@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    signInAs(user.id);

    await recordBooking(
      payload(listing.id, { checkIn: addDays(today, 5), checkOut: addDays(today, 8) }),
    );

    const days = await prisma.availability.findMany({
      where: { listingId: listing.id },
      orderBy: { date: "asc" },
    });
    expect(days).toHaveLength(3);
    expect(days.every((d) => d.status === "BOOKED" && d.sourceKey === "LOCAL")).toBe(true);
  });

  /**
   * The point of the retrospective branch. An owner backfilling last season's
   * Airbnb revenue is not claiming those days — they are spent, and very often
   * already closed by the feed for the very booking being recorded. Writing
   * over them would refuse the entry for no gain.
   */
  it("leaves the calendar alone for a stay that is entirely in the past", async () => {
    const { owner, user } = await createOwner({ email: "past@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    signInAs(user.id);

    const result = await recordBooking(
      payload(listing.id, {
        source: "AIRBNB",
        checkIn: addDays(today, -20),
        checkOut: addDays(today, -17),
        amount: "5200",
      }),
    );
    expect(result.ok).toBe(true);

    const days = await prisma.availability.findMany({ where: { listingId: listing.id } });
    expect(days).toHaveLength(0);

    // The revenue is still recorded — that is the entire reason for the entry.
    const booking = await prisma.bookingRequest.findFirst({ where: { listingId: listing.id } });
    expect(booking?.subtotal).toBe(5200);
  });

  /**
   * `/owner/bookings` renders every CONFIRMED booking whose stage is not DONE
   * as an uncapped, never-paged work queue. A season of backfilled stays
   * entered mid-workflow would sit in it forever.
   */
  it("files a past record as finished and a future one as still in progress", async () => {
    const { owner, user } = await createOwner({ email: "stage@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    signInAs(user.id);

    await recordBooking(
      payload(listing.id, {
        checkIn: addDays(today, -10),
        checkOut: addDays(today, -8),
        customerName: "قديم",
      }),
    );
    await recordBooking(
      payload(listing.id, {
        checkIn: addDays(today, 10),
        checkOut: addDays(today, 12),
        customerName: "قادم",
      }),
    );

    const past = await prisma.bookingRequest.findFirst({ where: { customerName: "قديم" } });
    const future = await prisma.bookingRequest.findFirst({ where: { customerName: "قادم" } });
    expect(past?.stage).toBe("DONE");
    expect(future?.stage).toBe("BALANCE");
  });

  it("refuses a future stay whose days are already taken", async () => {
    const { owner, user } = await createOwner({ email: "clash@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    signInAs(user.id);

    const clashing = addDays(today, 6);
    await prisma.availability.create({
      data: { listingId: listing.id, date: clashing, status: "BLOCKED" },
    });

    const result = await recordBooking(
      payload(listing.id, { checkIn: addDays(today, 5), checkOut: addDays(today, 8) }),
    );
    expect(result.ok).toBe(false);

    // And nothing was written — not the booking, not the other two days.
    expect(await prisma.bookingRequest.count()).toBe(0);
    expect(await prisma.availability.count()).toBe(1);
  });

  /**
   * A stay that started before today and runs on: only the days still ahead are
   * claimed. The days already spent are not contested.
   */
  it("claims only the remaining days of a stay already under way", async () => {
    const { owner, user } = await createOwner({ email: "straddle@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    signInAs(user.id);

    await recordBooking(
      payload(listing.id, { checkIn: addDays(today, -2), checkOut: addDays(today, 2) }),
    );

    const days = await prisma.availability.findMany({
      where: { listingId: listing.id },
      orderBy: { date: "asc" },
    });
    expect(days.map((d) => d.date)).toEqual([today, addDays(today, 1)]);
  });
});

/* -------------------------------------------------------------------------- */

describe("who may record one", () => {
  it("refuses an owner recording against another owner's rest house", async () => {
    const a = await createOwner({ email: "own-a@test.ae" });
    const b = await createOwner({ email: "own-b@test.ae" });
    const listingB = await createListing({ ownerId: b.owner.id });
    signInAs(a.user.id);

    const result = await recordBooking(payload(listingB.id));
    expect(result.ok).toBe(false);
    expect(await prisma.bookingRequest.count()).toBe(0);
  });

  it("refuses a signed-out caller", async () => {
    const { owner } = await createOwner({ email: "out@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    signInAs(null);

    const result = await recordBooking(payload(listing.id));
    expect(result.ok).toBe(false);
    expect(await prisma.bookingRequest.count()).toBe(0);
  });

  it("lets an operator record against any rest house", async () => {
    const { owner } = await createOwner({ email: "any@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    const admin = await prisma.user.create({
      data: {
        email: "op@test.ae",
        name: "Admin",
        passwordHash: "$2a$10$testtesttesttesttesttesttesttesttesttesttesttesttestte",
        role: "ADMIN",
      },
    });
    signInAs(admin.id);

    const result = await recordBooking(payload(listing.id));
    expect(result.ok).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe("what it refuses to store", () => {
  it("rejects a Rihla source, which only the public flow may write", async () => {
    const { owner, user } = await createOwner({ email: "rihla@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    signInAs(user.id);

    // Allowing it would invent a booking this platform has no record of taking,
    // and on which it would then be owed no commission.
    const result = await recordBooking(payload(listing.id, { source: "RIHLA" }));
    expect(result.ok).toBe(false);
    expect(await prisma.bookingRequest.count()).toBe(0);
  });

  it("rejects an unknown source, a bad date range and a negative amount", async () => {
    const { owner, user } = await createOwner({ email: "bad@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    signInAs(user.id);

    const cases: Record<string, string>[] = [
      { source: "CARRIER_PIGEON" },
      { checkIn: addDays(today, 8), checkOut: addDays(today, 5) },
      { checkIn: "not-a-date" },
      { amount: "-100" },
      { guests: "0" },
      { customerPhone: "12" },
    ];

    for (const overrides of cases) {
      const result = await recordBooking(payload(listing.id, overrides));
      expect(result.ok).toBe(false);
    }
    expect(await prisma.bookingRequest.count()).toBe(0);
  });

  /** A stay given to family is still a stay, and belongs in the occupancy. */
  it("accepts a zero amount", async () => {
    const { owner, user } = await createOwner({ email: "free@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    signInAs(user.id);

    const result = await recordBooking(payload(listing.id, { amount: "0" }));
    expect(result.ok).toBe(true);
  });
});
