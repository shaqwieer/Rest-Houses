import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import {
  createListing,
  createOwner,
  ensureSchema,
  prisma,
  resetDatabase,
  seedSettings,
} from "./db";
import { humanCheckFields } from "./human-check";
import { resetRateLimits, resetSpentChallenges } from "@/lib/security";
import { addDays, todayISO } from "@/lib/dates";
import { nightRate, quote, resolveCommissionPercent } from "@/lib/pricing";
import { getSpecialDays } from "@/lib/listings";

/**
 * Occasion pricing, per-owner commission, and the membership default.
 *
 * The money assertions are the point. Two of them guard rules that cost real
 * dirhams if they regress: that the occasion rate outranks the weekend rate,
 * and that the STORED total is computed from the database rather than from
 * anything the booking form sent.
 */

/**
 * Only `auth()` is faked — the guards themselves (`requireAdmin`,
 * `requireApprovedOwner`, `authorizeListing`) run for real against the
 * database. Mocking the guards would test nothing, and the whole point of the
 * calendar cases at the bottom is that the owner scope really is applied in
 * SQL. Same arrangement as tests/owner-workflow.test.ts.
 */
const sessionUser = vi.hoisted(() => ({ current: null as { id: string } | null }));

vi.mock("next-auth", async () => ({
  default: () => ({
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
    auth: async () => (sessionUser.current ? { user: { id: sessionUser.current.id } } : null),
  }),
  AuthError: class AuthError extends Error {},
}));

vi.mock("next-auth/providers/credentials", () => ({ default: () => ({}) }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("@/lib/i18n/server", async () => {
  const { ar } = await import("@/lib/i18n/ar");
  return {
    getLocale: async () => "ar",
    getT: async () => ar,
    getDir: async () => "rtl",
    getI18n: async () => ({ locale: "ar", t: ar, dir: "rtl" }),
  };
});

beforeAll(() => ensureSchema());
afterAll(async () => prisma.$disconnect());

beforeEach(async () => {
  await resetDatabase();
  await seedSettings({ serviceFeePercent: 0, depositPercent: 30 });
  resetRateLimits();
  resetSpentChallenges();
  sessionUser.current = null;
});

/* -------------------------------------------------------------------------- */
/* nightRate — the three-tier ladder                                          */
/* -------------------------------------------------------------------------- */

describe("nightRate", () => {
  const listing = {
    pricePerNight: 1000,
    weekendPrice: 1400,
    holidayPrice: 2500,
    weekendMode: "short" as const,
  };

  // 2026-08-12 is a Wednesday, 2026-08-15 a Saturday.
  const WEEKDAY = "2026-08-12";
  const WEEKEND = "2026-08-15";

  it("charges the weekday rate on an ordinary night", () => {
    expect(nightRate(listing, WEEKDAY).amount).toBe(1000);
  });

  it("charges the weekend rate on a weekend night", () => {
    expect(nightRate(listing, WEEKEND).amount).toBe(1400);
  });

  it("charges the occasion rate on a marked weekday", () => {
    const marked = new Map([[WEEKDAY, "عيد الفطر"]]);
    const result = nightRate(listing, WEEKDAY, marked);
    expect(result.amount).toBe(2500);
    expect(result.special).toBe("عيد الفطر");
  });

  it("lets the occasion rate OUTRANK the weekend rate", () => {
    // Eid falling on a Saturday is still Eid. The other order would charge the
    // lower of the two on precisely the nights demand is highest.
    const marked = new Map([[WEEKEND, "عيد الأضحى"]]);
    const result = nightRate(listing, WEEKEND, marked);
    expect(result.amount).toBe(2500);
    expect(result.weekend).toBe(true);
    expect(result.special).toBe("عيد الأضحى");
  });

  it("falls through when the listing has no occasion rate", () => {
    // 0 means "not offered" throughout this schema. Marking a day on a listing
    // that never set a rate must not make the night free.
    const noRate = { ...listing, holidayPrice: 0 };
    const marked = new Map([[WEEKDAY, "عيد"]]);
    expect(nightRate(noRate, WEEKDAY, marked).amount).toBe(1000);
    expect(nightRate(noRate, WEEKEND, marked).amount).toBe(1400);
  });

  it("prices a Sharjah Friday as a weekend night, and Eid above it", () => {
    const sharjah = { ...listing, weekendMode: "long" as const };
    const FRIDAY = "2026-08-14";
    expect(nightRate(sharjah, FRIDAY).amount).toBe(1400);
    expect(nightRate(sharjah, FRIDAY, new Map([[FRIDAY, ""]])).amount).toBe(2500);
  });
});

describe("quote with occasion nights", () => {
  it("prices a mixed stay night by night", () => {
    // Wed 12th → Sat 15th: three nights, the middle one marked.
    const q = quote({
      checkIn: "2026-08-12",
      checkOut: "2026-08-15",
      pricePerNight: 1000,
      weekendPrice: 1400,
      weekendMode: "short",
      holidayPrice: 2500,
      specialDays: new Map([["2026-08-13", "اليوم الوطني"]]),
      serviceFeePercent: 0,
      depositPercent: 30,
    });

    expect(q.breakdown.map((n) => n.amount)).toEqual([1000, 2500, 1000]);
    expect(q.subtotal).toBe(4500);
    // The occasion's name rides along so the guest is told why it costs more.
    expect(q.breakdown[1].special).toBe("اليوم الوطني");
    expect(q.breakdown[0].special).toBeUndefined();
  });

  it("prices exactly as before when nothing is marked", () => {
    const base = {
      checkIn: "2026-08-12",
      checkOut: "2026-08-15",
      pricePerNight: 1000,
      weekendPrice: 1400,
      weekendMode: "short" as const,
      serviceFeePercent: 0,
      depositPercent: 30,
    };
    expect(quote({ ...base, holidayPrice: 2500 }).total).toBe(quote(base).total);
  });
});

/* -------------------------------------------------------------------------- */
/* The stored total                                                           */
/* -------------------------------------------------------------------------- */

function bookingForm(listingId: string, checkIn: string, checkOut: string) {
  const fd = new FormData();
  fd.set("listingId", listingId);
  fd.set("checkIn", checkIn);
  fd.set("checkOut", checkOut);
  fd.set("guests", "10");
  fd.set("customerName", "Khalid Al Mansouri");
  fd.set("customerPhone", "+971502148890");
  fd.set("customerEmail", "");
  fd.set("notes", "");
  for (const [k, v] of Object.entries(humanCheckFields("booking"))) fd.set(k, v);
  return fd;
}

describe("createBookingRequest and occasion nights", () => {
  it("charges the occasion rate from the DATABASE, not from the form", async () => {
    const listing = await createListing({ pricePerNight: 1000, holidayPrice: 3000 });
    const checkIn = addDays(todayISO(), 7);
    const checkOut = addDays(checkIn, 2);

    await prisma.specialDay.create({
      data: { listingId: listing.id, date: checkIn, label: "رأس السنة" },
    });

    const { createBookingRequest } = await import("@/app/actions/booking");
    // The form carries nothing about special days and could not be trusted if
    // it did — this is the assertion that a tampered client cannot book Eid at
    // the weekday rate.
    const result = await createBookingRequest(bookingForm(listing.id, checkIn, checkOut));
    expect(result.ok).toBe(true);

    const booking = await prisma.bookingRequest.findFirstOrThrow();
    // Night 1 is the marked one (3000), night 2 ordinary (1000).
    expect(booking.subtotal).toBe(4000);
  });

  it("ignores marked days outside the booked range", async () => {
    const listing = await createListing({ pricePerNight: 1000, holidayPrice: 3000 });
    const checkIn = addDays(todayISO(), 7);
    const checkOut = addDays(checkIn, 2);

    // Marked, but after the stay ends — and on the checkout morning, which is
    // not a night this guest occupies.
    await prisma.specialDay.create({ data: { listingId: listing.id, date: checkOut } });

    const { createBookingRequest } = await import("@/app/actions/booking");
    await createBookingRequest(bookingForm(listing.id, checkIn, checkOut));

    const booking = await prisma.bookingRequest.findFirstOrThrow();
    expect(booking.subtotal).toBe(2000);
  });
});

describe("getSpecialDays", () => {
  it("bounds by the range half-open, matching the nights charged", async () => {
    const listing = await createListing();
    for (const date of ["2026-08-10", "2026-08-11", "2026-08-12"]) {
      await prisma.specialDay.create({ data: { listingId: listing.id, date, label: "x" } });
    }

    const inRange = await getSpecialDays(listing.id, "2026-08-10", "2026-08-12");
    // The checkout day is excluded — it is not a night of this stay.
    expect([...inRange.keys()]).toEqual(["2026-08-10", "2026-08-11"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Per-owner commission                                                       */
/* -------------------------------------------------------------------------- */

describe("resolveCommissionPercent", () => {
  it("falls back to the platform rate when the owner has none", () => {
    expect(resolveCommissionPercent(null, 5)).toBe(5);
    expect(resolveCommissionPercent(undefined, 5)).toBe(5);
  });

  it("keeps a negotiated 0 rather than collapsing it to the platform rate", () => {
    // The whole reason the column is nullable. A truthiness check here would
    // bill an owner who was promised nothing.
    expect(resolveCommissionPercent(0, 5)).toBe(0);
  });

  it("uses the owner's rate when they have one", () => {
    expect(resolveCommissionPercent(12, 5)).toBe(12);
  });

  it("clamps a value that bypassed validation", () => {
    expect(resolveCommissionPercent(500, 5)).toBe(100);
    expect(resolveCommissionPercent(-10, 5)).toBe(0);
  });
});

describe("commission on a booking", () => {
  async function bookOn(listingId: string) {
    const checkIn = addDays(todayISO(), 7);
    const { createBookingRequest } = await import("@/app/actions/booking");
    const result = await createBookingRequest(
      bookingForm(listingId, checkIn, addDays(checkIn, 2)),
    );
    expect(result.ok).toBe(true);
    return prisma.bookingRequest.findFirstOrThrow({ where: { listingId } });
  }

  it("snapshots the owner's negotiated rate", async () => {
    const { owner } = await createOwner({ email: "deal@test.ae", commissionPercent: 12 });
    const listing = await createListing({ ownerId: owner.id, pricePerNight: 1000 });

    const booking = await bookOn(listing.id);
    expect(booking.commissionPercent).toBe(12);
    expect(booking.commissionDue).toBe(240); // 12% of 2000
  });

  it("charges nothing to an owner on a zero-commission deal", async () => {
    const { owner } = await createOwner({ email: "free@test.ae", commissionPercent: 0 });
    const listing = await createListing({ ownerId: owner.id, pricePerNight: 1000 });

    const booking = await bookOn(listing.id);
    expect(booking.commissionPercent).toBe(0);
    expect(booking.commissionDue).toBe(0);
  });

  it("uses the platform rate for an owner with no deal", async () => {
    const { owner } = await createOwner({ email: "std@test.ae" });
    const listing = await createListing({ ownerId: owner.id, pricePerNight: 1000 });

    const booking = await bookOn(listing.id);
    expect(booking.commissionPercent).toBe(5);
    expect(booking.commissionDue).toBe(100);
  });

  it("uses the platform rate for a platform-owned listing", async () => {
    const listing = await createListing({ ownerId: null, pricePerNight: 1000 });
    const booking = await bookOn(listing.id);
    expect(booking.commissionPercent).toBe(5);
  });

  it("does not rewrite an existing booking when the owner's rate changes", async () => {
    const { owner } = await createOwner({ email: "renegotiate@test.ae", commissionPercent: 5 });
    const listing = await createListing({ ownerId: owner.id, pricePerNight: 1000 });
    const booking = await bookOn(listing.id);

    await prisma.ownerProfile.update({
      where: { id: owner.id },
      data: { commissionPercent: 25 },
    });

    const after = await prisma.bookingRequest.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after.commissionPercent).toBe(5);
    expect(after.commissionDue).toBe(100);
  });
});

/* -------------------------------------------------------------------------- */
/* Membership                                                                 */
/* -------------------------------------------------------------------------- */

describe("approving an owner", () => {
  async function signInAsAdmin() {
    const admin = await prisma.user.create({
      data: {
        email: "admin@test.ae",
        name: "Admin",
        passwordHash: "$2a$10$testtesttesttesttesttesttesttesttesttesttesttesttestte",
        role: "ADMIN",
      },
    });
    sessionUser.current = { id: admin.id };
    return admin;
  }

  it("leaves the membership open-ended by default", async () => {
    await signInAsAdmin();
    const { owner } = await createOwner({ email: "new@test.ae", status: "PENDING" });

    // No second argument — the case that used to schedule an owner's listings
    // to disappear in twelve months with nothing on screen saying so.
    const { approveOwner } = await import("@/app/actions/owners");
    const result = await approveOwner(owner.id);
    expect(result.ok).toBe(true);

    const after = await prisma.ownerProfile.findUniqueOrThrow({ where: { id: owner.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.membershipExpiresAt).toBeNull();
  });

  it("still honours an explicit window when one is asked for", async () => {
    await signInAsAdmin();
    const { owner } = await createOwner({ email: "timed@test.ae", status: "PENDING" });

    const { approveOwner } = await import("@/app/actions/owners");
    await approveOwner(owner.id, 12);

    const after = await prisma.ownerProfile.findUniqueOrThrow({ where: { id: owner.id } });
    expect(after.membershipExpiresAt).not.toBeNull();
    expect(after.membershipExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

/* -------------------------------------------------------------------------- */
/* The owner calendar — the guard that was widened from admin-only            */
/* -------------------------------------------------------------------------- */

describe("owner access to the calendar actions", () => {
  it("lets an owner block a day on their OWN listing", async () => {
    const { owner, user } = await createOwner({ email: "mine@test.ae" });
    const listing = await createListing({ ownerId: owner.id });
    sessionUser.current = { id: user.id };

    const date = addDays(todayISO(), 5);
    const { toggleBlockedDate } = await import("@/app/actions/availability");
    const result = await toggleBlockedDate(listing.id, date);

    expect(result.ok).toBe(true);
    expect(await prisma.availability.count({ where: { listingId: listing.id, date } })).toBe(1);
  });

  it("refuses an owner acting on another owner's listing", async () => {
    // The regression this exists to catch. Widening the guard from
    // `requireAdmin()` without also scoping the lookup by ownerId would let any
    // approved owner block days on any listing on the platform.
    const { user } = await createOwner({ email: "a@test.ae" });
    const { owner: theirs } = await createOwner({ email: "b@test.ae" });
    const otherListing = await createListing({ ownerId: theirs.id });
    sessionUser.current = { id: user.id };

    const date = addDays(todayISO(), 5);
    const { toggleBlockedDate, toggleSpecialDate } = await import(
      "@/app/actions/availability"
    );

    expect((await toggleBlockedDate(otherListing.id, date)).ok).toBe(false);
    expect((await toggleSpecialDate(otherListing.id, date)).ok).toBe(false);
    // Nothing was written to either table.
    expect(await prisma.availability.count()).toBe(0);
    expect(await prisma.specialDay.count()).toBe(0);
  });

  it("refuses a suspended owner even on their own listing", async () => {
    // Status is re-read from the database per call, so a session minted while
    // the account was fine does not survive a suspension.
    const { owner, user } = await createOwner({ email: "susp@test.ae", status: "SUSPENDED" });
    const listing = await createListing({ ownerId: owner.id });
    sessionUser.current = { id: user.id };

    const { toggleBlockedDate } = await import("@/app/actions/availability");
    expect((await toggleBlockedDate(listing.id, addDays(todayISO(), 5))).ok).toBe(false);
    expect(await prisma.availability.count()).toBe(0);
  });

  it("lets an owner mark and unmark an occasion night", async () => {
    const { owner, user } = await createOwner({ email: "eid@test.ae" });
    const listing = await createListing({ ownerId: owner.id, holidayPrice: 3000 });
    sessionUser.current = { id: user.id };

    const date = addDays(todayISO(), 30);
    const { toggleSpecialDate } = await import("@/app/actions/availability");

    await toggleSpecialDate(listing.id, date, "عيد الفطر");
    const marked = await prisma.specialDay.findFirstOrThrow({
      where: { listingId: listing.id },
    });
    expect(marked.date).toBe(date);
    expect(marked.label).toBe("عيد الفطر");

    await toggleSpecialDate(listing.id, date);
    expect(await prisma.specialDay.count({ where: { listingId: listing.id } })).toBe(0);
  });

  it("marks a day that is also blocked — the two are separate questions", async () => {
    const { owner, user } = await createOwner({ email: "both@test.ae" });
    const listing = await createListing({ ownerId: owner.id, holidayPrice: 3000 });
    sessionUser.current = { id: user.id };

    const date = addDays(todayISO(), 30);
    const { toggleBlockedDate, toggleSpecialDate } = await import(
      "@/app/actions/availability"
    );
    await toggleBlockedDate(listing.id, date);
    const result = await toggleSpecialDate(listing.id, date, "عيد");

    expect(result.ok).toBe(true);
    expect(await prisma.availability.count({ where: { date } })).toBe(1);
    expect(await prisma.specialDay.count({ where: { date } })).toBe(1);
  });

  it("refuses to reprice a night in the past", async () => {
    const { owner, user } = await createOwner({ email: "past@test.ae" });
    const listing = await createListing({ ownerId: owner.id, holidayPrice: 3000 });
    sessionUser.current = { id: user.id };

    const { toggleSpecialDate } = await import("@/app/actions/availability");
    expect((await toggleSpecialDate(listing.id, addDays(todayISO(), -1))).ok).toBe(false);
  });
});
