import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import {
  createListing,
  ensureSchema,
  prisma,
  resetDatabase,
  seedSettings,
} from "./db";
import { humanCheckFields } from "./human-check";
import { resetRateLimits, resetSpentChallenges } from "@/lib/security";
import { addDays, dayOfWeek, occupiedDays, todayISO } from "@/lib/dates";
import { dayUseRate, quote } from "@/lib/pricing";

/**
 * Requirement 7: a day booking (حجز بدون مبيت) is a real reservation made from
 * the calendar, not a price to discuss on WhatsApp.
 *
 * ─── The two ways this feature can be catastrophic ───────────────────────────
 * Both come from the same root: a day booking has ZERO nights, and every piece
 * of machinery here was built on nights.
 *
 *   1. **A free booking.** `quote()` builds its breakdown from `nightsInRange`,
 *      which returns [] when check-in and check-out are the same day. Run a
 *      day booking through it unchanged and the subtotal is 0 — a rest house
 *      booked for nothing. The `dayUse` flag exists to force the other branch.
 *
 *   2. **A double booking.** Confirmation blocks `nightsInRange(...)` in
 *      `Availability`. For a day booking that is an empty list, so nothing is
 *      blocked, the day stays open, and two parties turn up to the same
 *      majlis. `occupiedDays()` exists to close that.
 *
 * Neither throws. Both look like success. So the tests below assert the stored
 * numbers and the stored calendar rows, never just `result.ok`.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

/**
 * Confirming a booking is an admin action, so those tests need a session.
 * Only `auth()` is faked — `requireAdmin` runs for real against the database,
 * which is what makes "confirming blocks the calendar" a test of the real path.
 * next-auth is replaced outright rather than spread over, because importing the
 * real module pulls in `next/server`.
 */
const sessionUser = vi.hoisted(() => ({ current: null as { id: string } | null }));

vi.mock("next-auth", () => ({
  default: () => ({
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
    auth: async () =>
      sessionUser.current ? { user: { id: sessionUser.current.id } } : null,
  }),
  AuthError: class AuthError extends Error {},
}));

vi.mock("next-auth/providers/credentials", () => ({ default: () => ({}) }));

vi.mock("@/lib/i18n/server", async () => {
  const { ar } = await import("@/lib/i18n/ar");
  return {
    getLocale: async () => "ar",
    getT: async () => ar,
    getDir: async () => "rtl",
    getI18n: async () => ({ locale: "ar", t: ar, dir: "rtl" }),
  };
});

beforeAll(() => {
  ensureSchema();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await seedSettings({ serviceFeePercent: 0, depositPercent: 30 });
  resetRateLimits();
  resetSpentChallenges();

  // A real operator row, so `requireAdmin`'s database read finds an ADMIN.
  const admin = await prisma.user.create({
    data: { email: "operator@example.ae", passwordHash: "x", role: "ADMIN" },
  });
  sessionUser.current = { id: admin.id };
});

/**
 * A weekday at least a week out — on EITHER weekend, so the same date is a
 * plain weekday for a short-weekend listing and for a long-weekend one alike.
 * Fri(5), Sat(6) and Sun(0) are all excluded; see `isWeekend` in src/lib/dates.
 */
function futureWeekday(): string {
  let day = addDays(todayISO(), 7);
  while (dayOfWeek(day) === 5 || dayOfWeek(day) === 6 || dayOfWeek(day) === 0) {
    day = addDays(day, 1);
  }
  return day;
}

/** The next Friday at least a week out — a weekend day only on "long". */
function futureFriday(): string {
  let day = addDays(todayISO(), 7);
  while (dayOfWeek(day) !== 5) day = addDays(day, 1);
  return day;
}

/** The next Saturday at least a week out — a weekend day on both modes. */
function futureSaturday(): string {
  let day = addDays(todayISO(), 7);
  while (dayOfWeek(day) !== 6) day = addDays(day, 1);
  return day;
}

function bookingForm(
  listingId: string,
  opts: { checkIn: string; checkOut: string } & Record<string, string>,
) {
  const fd = new FormData();
  fd.set("listingId", listingId);
  fd.set("checkIn", opts.checkIn);
  fd.set("checkOut", opts.checkOut);
  if (opts.dayUse) fd.set("dayUse", opts.dayUse);
  fd.set("guests", opts.guests ?? "10");
  fd.set("customerName", opts.customerName ?? "Khalid Al Mansouri");
  fd.set("customerPhone", opts.customerPhone ?? "971502148890");
  fd.set("customerEmail", "");
  fd.set("notes", "");
  for (const [k, v] of Object.entries(humanCheckFields("booking"))) fd.set(k, v);
  return fd;
}

/* -------------------------------------------------------------------------- */
/* occupiedDays — the availability choke point                                */
/* -------------------------------------------------------------------------- */

describe("occupiedDays", () => {
  it("returns the single day for a day booking", () => {
    expect(occupiedDays("2026-09-10", "2026-09-10", true)).toEqual(["2026-09-10"]);
  });

  /**
   * The bug this whole helper exists to prevent: the night-based view of a
   * same-day range is empty, so nothing would be blocked.
   */
  it("would have blocked nothing without the flag", () => {
    expect(occupiedDays("2026-09-10", "2026-09-10", false)).toEqual([]);
  });

  it("is unchanged for an overnight stay", () => {
    expect(occupiedDays("2026-09-10", "2026-09-13")).toEqual([
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
    ]);
  });

  /** Check-out morning stays free — the next guest arrives that afternoon. */
  it("does not occupy the check-out day of a stay", () => {
    expect(occupiedDays("2026-09-10", "2026-09-11")).toEqual(["2026-09-10"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Pricing                                                                    */
/* -------------------------------------------------------------------------- */

describe("dayUseRate", () => {
  it("is 0 when the listing does not offer day use", () => {
    expect(
      dayUseRate({ dayUsePrice: 0, dayUseWeekendPrice: 0, weekendMode: "short" }, "2026-09-10"),
    ).toBe(0);
  });

  /** A weekend rate alone does not make day use available — the base is the switch. */
  it("is 0 when only a weekend rate is set", () => {
    expect(
      dayUseRate(
        { dayUsePrice: 0, dayUseWeekendPrice: 900, weekendMode: "short" },
        futureSaturday(),
      ),
    ).toBe(0);
  });

  it("uses the weekend rate on a Saturday", () => {
    const rate = dayUseRate(
      { dayUsePrice: 600, dayUseWeekendPrice: 900, weekendMode: "short" },
      futureSaturday(),
    );
    expect(rate).toBe(900);
  });

  it("uses the weekday rate otherwise", () => {
    const rate = dayUseRate(
      { dayUsePrice: 600, dayUseWeekendPrice: 900, weekendMode: "short" },
      futureWeekday(),
    );
    expect(rate).toBe(600);
  });

  /**
   * Friday is the day the two modes disagree about, and a day-use booking is
   * where an owner notices it first: the same Friday is a weekday rate in Dubai
   * and a weekend rate in Sharjah.
   */
  it("charges Friday at the weekday rate on a short weekend", () => {
    expect(
      dayUseRate(
        { dayUsePrice: 600, dayUseWeekendPrice: 900, weekendMode: "short" },
        futureFriday(),
      ),
    ).toBe(600);
  });

  it("charges the same Friday at the weekend rate on a long weekend", () => {
    expect(
      dayUseRate(
        { dayUsePrice: 600, dayUseWeekendPrice: 900, weekendMode: "long" },
        futureFriday(),
      ),
    ).toBe(900);
  });

  /** A blank weekend rate falls back to the weekday one rather than to 0. */
  it("falls back to the weekday rate when no weekend rate is set", () => {
    expect(
      dayUseRate(
        { dayUsePrice: 600, dayUseWeekendPrice: 0, weekendMode: "short" },
        futureSaturday(),
      ),
    ).toBe(600);
  });
});

describe("quote (day use)", () => {
  it("prices one day at the day rate, with zero nights", () => {
    const day = futureWeekday();
    const q = quote({
      checkIn: day,
      checkOut: day,
      pricePerNight: 2000,
      weekendPrice: 2500,
      weekendMode: "short",
      serviceFeePercent: 0,
      depositPercent: 30,
      dayUse: true,
      dayUsePrice: 600,
      dayUseWeekendPrice: 900,
    });

    expect(q.dayUse).toBe(true);
    expect(q.nights).toBe(0);
    expect(q.subtotal).toBe(600);
    expect(q.total).toBe(600);
    // Never the nightly rate — that is the whole point of the branch.
    expect(q.subtotal).not.toBe(2000);
  });

  /**
   * The catastrophic case, pinned. This is what the same dates produce WITHOUT
   * the flag, and it is why the flag is an explicit input rather than something
   * inferred from `checkIn === checkOut`.
   */
  it("produces a total of zero for the same dates without the flag", () => {
    const day = futureWeekday();
    const q = quote({
      checkIn: day,
      checkOut: day,
      pricePerNight: 2000,
      weekendMode: "short",
      serviceFeePercent: 0,
      depositPercent: 30,
    });

    expect(q.nights).toBe(0);
    expect(q.total).toBe(0);
    expect(q.dayUse).toBe(false);
  });

  it("applies the weekend day rate on a Saturday", () => {
    const saturday = futureSaturday();
    const q = quote({
      checkIn: saturday,
      checkOut: saturday,
      pricePerNight: 2000,
      weekendMode: "short",
      serviceFeePercent: 0,
      depositPercent: 30,
      dayUse: true,
      dayUsePrice: 600,
      dayUseWeekendPrice: 900,
    });

    expect(q.subtotal).toBe(900);
  });

  /** The same Friday, the same rates, two different totals — per listing. */
  it("prices a Friday day booking by the listing's own weekend", () => {
    const friday = futureFriday();
    const rates = {
      checkOut: friday,
      pricePerNight: 2000,
      serviceFeePercent: 0,
      depositPercent: 30,
      dayUse: true,
      dayUsePrice: 600,
      dayUseWeekendPrice: 900,
    } as const;

    expect(quote({ checkIn: friday, weekendMode: "short", ...rates }).subtotal).toBe(600);
    expect(quote({ checkIn: friday, weekendMode: "long", ...rates }).subtotal).toBe(900);
  });

  it("still takes a deposit, computed on the day total", () => {
    const day = futureWeekday();
    const q = quote({
      checkIn: day,
      checkOut: day,
      pricePerNight: 2000,
      weekendMode: "short",
      serviceFeePercent: 0,
      depositPercent: 50,
      dayUse: true,
      dayUsePrice: 600,
    });

    expect(q.total).toBe(600);
    expect(q.depositDue).toBe(300);
  });

  it("leaves overnight quotes exactly as they were", () => {
    const checkIn = futureWeekday();
    const q = quote({
      checkIn,
      checkOut: addDays(checkIn, 2),
      pricePerNight: 1000,
      weekendMode: "short",
      serviceFeePercent: 0,
      depositPercent: 30,
      // Present but false — a listing that offers day use must still be
      // bookable overnight at the nightly rate.
      dayUse: false,
      dayUsePrice: 600,
    });

    expect(q.dayUse).toBe(false);
    expect(q.nights).toBe(2);
    expect(q.subtotal).toBe(2000);
  });
});

/* -------------------------------------------------------------------------- */
/* The server action                                                          */
/* -------------------------------------------------------------------------- */

describe("createBookingRequest (day use)", () => {
  it("stores a day booking with zero nights and the same two dates", async () => {
    const listing = await createListing({ pricePerNight: 2000, dayUsePrice: 600 });
    const day = futureWeekday();

    const { createBookingRequest } = await import("@/app/actions/booking");
    const result = await createBookingRequest(
      bookingForm(listing.id, { checkIn: day, checkOut: day, dayUse: "on" }),
    );

    expect(result.ok).toBe(true);

    const booking = await prisma.bookingRequest.findFirst();
    expect(booking!.dayUse).toBe(true);
    expect(booking!.nights).toBe(0);
    expect(booking!.checkIn).toBe(day);
    expect(booking!.checkOut).toBe(day);
    // Priced from the day rate, and emphatically not free.
    expect(booking!.total).toBe(600);
    expect(booking!.subtotal).toBe(600);
  });

  /**
   * `dayUsePrice = 0` means "not offered". Without this guard the quote prices
   * the stay at 0 and the action writes a booking worth nothing — reachable by
   * anyone posting the flag directly, and by any visitor whose page was
   * rendered before the owner switched day use off.
   */
  it("refuses a day booking on a listing that does not offer one", async () => {
    const listing = await createListing({ pricePerNight: 2000, dayUsePrice: 0 });
    const day = futureWeekday();

    const { createBookingRequest } = await import("@/app/actions/booking");
    const result = await createBookingRequest(
      bookingForm(listing.id, { checkIn: day, checkOut: day, dayUse: "on" }),
    );

    expect(result.ok).toBe(false);
    expect(await prisma.bookingRequest.count()).toBe(0);
  });

  /**
   * The pre-existing zero-night guard must not have been loosened by any of
   * this. A same-day range WITHOUT the flag is still a malformed overnight
   * request, and it is the one thing standing between that and a free booking.
   */
  it("still refuses a zero-night stay that does not claim day use", async () => {
    const listing = await createListing({ pricePerNight: 2000, dayUsePrice: 600 });
    const day = futureWeekday();

    const { createBookingRequest } = await import("@/app/actions/booking");
    const result = await createBookingRequest(
      bookingForm(listing.id, { checkIn: day, checkOut: day }),
    );

    expect(result.ok).toBe(false);
    expect(await prisma.bookingRequest.count()).toBe(0);
  });

  /** A day booking spanning two dates is a contradiction; refuse, don't guess. */
  it("refuses a day booking whose check-out is a different date", async () => {
    const listing = await createListing({ pricePerNight: 2000, dayUsePrice: 600 });
    const day = futureWeekday();

    const { createBookingRequest } = await import("@/app/actions/booking");
    const result = await createBookingRequest(
      bookingForm(listing.id, {
        checkIn: day,
        checkOut: addDays(day, 3),
        dayUse: "on",
      }),
    );

    expect(result.ok).toBe(false);
    expect(await prisma.bookingRequest.count()).toBe(0);
  });

  it("refuses a day booking in the past", async () => {
    const listing = await createListing({ pricePerNight: 2000, dayUsePrice: 600 });
    const past = addDays(todayISO(), -3);

    const { createBookingRequest } = await import("@/app/actions/booking");
    const result = await createBookingRequest(
      bookingForm(listing.id, { checkIn: past, checkOut: past, dayUse: "on" }),
    );

    expect(result.ok).toBe(false);
    expect(await prisma.bookingRequest.count()).toBe(0);
  });

  /** The rate comes from the row, never the form — same rule as every amount. */
  it("ignores a day price posted by the browser", async () => {
    const listing = await createListing({ pricePerNight: 2000, dayUsePrice: 600 });
    const day = futureWeekday();

    const fd = bookingForm(listing.id, { checkIn: day, checkOut: day, dayUse: "on" });
    fd.set("dayUsePrice", "1");
    fd.set("total", "1");
    fd.set("subtotal", "1");

    const { createBookingRequest } = await import("@/app/actions/booking");
    await createBookingRequest(fd);

    const booking = await prisma.bookingRequest.findFirst();
    expect(booking!.total).toBe(600);
  });

  /** A day-use listing must still take overnight bookings at the nightly rate. */
  it("still books an overnight stay on a listing that offers day use", async () => {
    const listing = await createListing({ pricePerNight: 2000, dayUsePrice: 600 });
    const checkIn = futureWeekday();

    const { createBookingRequest } = await import("@/app/actions/booking");
    const result = await createBookingRequest(
      bookingForm(listing.id, { checkIn, checkOut: addDays(checkIn, 2) }),
    );

    expect(result.ok).toBe(true);
    const booking = await prisma.bookingRequest.findFirst();
    expect(booking!.dayUse).toBe(false);
    expect(booking!.nights).toBe(2);
    expect(booking!.total).toBe(4000);
  });

  /** A day already blocked by the owner is not bookable for the day either. */
  it("refuses a day the owner has blocked", async () => {
    const listing = await createListing({ pricePerNight: 2000, dayUsePrice: 600 });
    const day = futureWeekday();
    await prisma.availability.create({
      data: { listingId: listing.id, date: day, status: "BLOCKED" },
    });

    const { createBookingRequest } = await import("@/app/actions/booking");
    const result = await createBookingRequest(
      bookingForm(listing.id, { checkIn: day, checkOut: day, dayUse: "on" }),
    );

    expect(result.ok).toBe(false);
    expect(await prisma.bookingRequest.count()).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Confirmation — the calendar side                                           */
/* -------------------------------------------------------------------------- */

describe("confirming a day booking", () => {
  /**
   * The double-booking case. Confirmation has to write an `Availability` row
   * for the day; without `occupiedDays` it writes none and the day stays open.
   */
  it("blocks exactly the one day on the calendar", async () => {
    const listing = await createListing({ pricePerNight: 2000, dayUsePrice: 600 });
    const day = futureWeekday();

    const { createBookingRequest } = await import("@/app/actions/booking");
    await createBookingRequest(
      bookingForm(listing.id, { checkIn: day, checkOut: day, dayUse: "on" }),
    );
    const booking = await prisma.bookingRequest.findFirstOrThrow();

    const { setRequestStatus } = await import("@/app/actions/requests");
    const result = await setRequestStatus(booking.id, "CONFIRMED");
    expect(result.ok).toBe(true);

    const blocked = await prisma.availability.findMany({
      where: { listingId: listing.id },
    });
    expect(blocked).toHaveLength(1);
    expect(blocked[0].date).toBe(day);
    expect(blocked[0].status).toBe("BOOKED");
  });

  it("releases that day again when the booking is cancelled", async () => {
    const listing = await createListing({ pricePerNight: 2000, dayUsePrice: 600 });
    const day = futureWeekday();

    const { createBookingRequest } = await import("@/app/actions/booking");
    await createBookingRequest(
      bookingForm(listing.id, { checkIn: day, checkOut: day, dayUse: "on" }),
    );
    const booking = await prisma.bookingRequest.findFirstOrThrow();

    const { setRequestStatus } = await import("@/app/actions/requests");
    await setRequestStatus(booking.id, "CONFIRMED");
    await setRequestStatus(booking.id, "CANCELLED");

    // A cancelled day booking that left its day blocked would take the rest
    // house off the market permanently, with nothing on screen explaining why.
    expect(await prisma.availability.count({ where: { listingId: listing.id } })).toBe(0);
  });

  /** A confirmed day booking closes the day to a would-be overnight guest. */
  it("makes the day unavailable to a subsequent stay", async () => {
    const listing = await createListing({ pricePerNight: 2000, dayUsePrice: 600 });
    const day = futureWeekday();

    const { createBookingRequest } = await import("@/app/actions/booking");
    await createBookingRequest(
      bookingForm(listing.id, { checkIn: day, checkOut: day, dayUse: "on" }),
    );
    const booking = await prisma.bookingRequest.findFirstOrThrow();

    const { setRequestStatus } = await import("@/app/actions/requests");
    await setRequestStatus(booking.id, "CONFIRMED");

    const { isRangeAvailable } = await import("@/lib/listings");
    expect(await isRangeAvailable(listing.id, day, addDays(day, 2))).toBe(false);
    // …and to a second day booking on the same day.
    expect(await isRangeAvailable(listing.id, day, day, true)).toBe(false);
  });

  /** The day after is untouched — the block is one day, not a range. */
  it("leaves the following day free", async () => {
    const listing = await createListing({ pricePerNight: 2000, dayUsePrice: 600 });
    const day = futureWeekday();

    const { createBookingRequest } = await import("@/app/actions/booking");
    await createBookingRequest(
      bookingForm(listing.id, { checkIn: day, checkOut: day, dayUse: "on" }),
    );
    const booking = await prisma.bookingRequest.findFirstOrThrow();

    const { setRequestStatus } = await import("@/app/actions/requests");
    await setRequestStatus(booking.id, "CONFIRMED");

    const { isRangeAvailable } = await import("@/lib/listings");
    const next = addDays(day, 1);
    expect(await isRangeAvailable(listing.id, next, next, true)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* isRangeAvailable                                                           */
/* -------------------------------------------------------------------------- */

describe("isRangeAvailable", () => {
  it("reports a free day as available for a day booking", async () => {
    const listing = await createListing({ dayUsePrice: 600 });
    const day = futureWeekday();

    const { isRangeAvailable } = await import("@/lib/listings");
    expect(await isRangeAvailable(listing.id, day, day, true)).toBe(true);
  });

  /**
   * Without the flag a same-day range has no nights, and "no nights" is not an
   * available stay — it is not a stay. That must stay false.
   */
  it("reports a same-day range as unavailable when day use is not claimed", async () => {
    const listing = await createListing();
    const day = futureWeekday();

    const { isRangeAvailable } = await import("@/lib/listings");
    expect(await isRangeAvailable(listing.id, day, day, false)).toBe(false);
  });
});
