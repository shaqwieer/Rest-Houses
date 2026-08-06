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
import {
  addDays,
  buildMonthGrid,
  dayOfWeek,
  isWeekend,
  todayISO,
  toWeekendMode,
  weekendDays,
} from "@/lib/dates";
import { quote } from "@/lib/pricing";
import {
  platformPolicyFor,
  resolveFreeCancelHours,
  resolveListingPolicy,
  resolveStayTimes,
} from "@/lib/policies";

/**
 * Two things that used to have one platform-wide answer and now belong to the
 * individual rest house.
 *
 * ─── The weekend ─────────────────────────────────────────────────────────────
 * `isWeekend` was a constant: Friday + Saturday, everywhere. Two things are
 * wrong with that. The UAE weekend moved to Saturday + Sunday in 2022, and
 * Sharjah does not share it at all — the emirate works a four-day week, so
 * Friday is a day off there and a Sharjah rest house is full on Friday night
 * while a Dubai one is not. One national constant either overcharges half the
 * catalogue or undercharges the other half; there is no value that is right for
 * both. So the weekend is a column on the listing.
 *
 * The failure mode worth pinning is quiet: a wrong weekend does not throw, it
 * just charges the weekday rate on the busiest night of the week. Every case
 * below therefore asserts a stored or computed AMOUNT, never `result.ok`.
 *
 * ─── The stay policy ─────────────────────────────────────────────────────────
 * Check-in, check-out and the free-cancellation window lived only on
 * SiteSettings, so every listing page printed the same hours no matter what the
 * owner actually did. Now each is a per-listing override with a fallback, and
 * the trap being guarded is the null/0 one: null means "use the platform's
 * window", 0 means "I allow no free cancellation". Collapse the two and the
 * platform publishes a 48-hour promise on behalf of an owner who refused it.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

/**
 * Only `auth()` is faked. `requireApprovedOwner` runs for real against the
 * database, so the save round-trip at the bottom of this file goes through the
 * same authorisation the live form does.
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
  await seedSettings({ serviceFeePercent: 0, depositPercent: 30, freeCancelHours: 48 });
  sessionUser.current = null;
  resetRateLimits();
  resetSpentChallenges();
});

/** The next Thursday at least a week out — a weekday under both modes. */
function futureThursday(): string {
  let day = addDays(todayISO(), 7);
  while (dayOfWeek(day) !== 4) day = addDays(day, 1);
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
  fd.set("guests", opts.guests ?? "10");
  fd.set("customerName", opts.customerName ?? "Khalid Al Mansouri");
  fd.set("customerPhone", opts.customerPhone ?? "+971502148890");
  fd.set("customerEmail", "");
  fd.set("notes", "");
  for (const [k, v] of Object.entries(humanCheckFields("booking"))) fd.set(k, v);
  return fd;
}

/* -------------------------------------------------------------------------- */
/* Which days each weekend covers                                             */
/* -------------------------------------------------------------------------- */

describe("weekend modes", () => {
  // 2026-07-30 Thu · 07-31 Fri · 08-01 Sat · 08-02 Sun · 08-03 Mon
  const THU = "2026-07-30";
  const FRI = "2026-07-31";
  const SAT = "2026-08-01";
  const SUN = "2026-08-02";
  const MON = "2026-08-03";

  it("counts Saturday and Sunday on a short weekend", () => {
    expect(isWeekend(SAT, "short")).toBe(true);
    expect(isWeekend(SUN, "short")).toBe(true);
  });

  /** The one day the two modes disagree about, which is the whole feature. */
  it("does not count Friday on a short weekend", () => {
    expect(isWeekend(FRI, "short")).toBe(false);
  });

  it("counts Friday, Saturday and Sunday on a long weekend", () => {
    expect(isWeekend(FRI, "long")).toBe(true);
    expect(isWeekend(SAT, "long")).toBe(true);
    expect(isWeekend(SUN, "long")).toBe(true);
  });

  it("counts neither Thursday nor Monday under either mode", () => {
    for (const mode of ["short", "long"] as const) {
      expect(isWeekend(THU, mode)).toBe(false);
      expect(isWeekend(MON, mode)).toBe(false);
    }
  });

  it("is exactly two days short and three days long", () => {
    expect(weekendDays("short")).toHaveLength(2);
    expect(weekendDays("long")).toHaveLength(3);
  });

  /**
   * The column is a plain String, so a stray value has to resolve to a real
   * weekend. Returning an undefined day set would price every night — including
   * Saturday — at the weekday rate, on every listing at once.
   */
  it("normalises anything unexpected to the UAE weekend", () => {
    expect(toWeekendMode("SHORT")).toBe("short");
    expect(toWeekendMode("friday+saturday")).toBe("short");
    expect(toWeekendMode(null)).toBe("short");
    expect(toWeekendMode(undefined)).toBe("short");
    expect(toWeekendMode(7)).toBe("short");
    expect(toWeekendMode("long")).toBe("long");
  });
});

/* -------------------------------------------------------------------------- */
/* Pricing                                                                    */
/* -------------------------------------------------------------------------- */

describe("quote() by weekend mode", () => {
  // Thu → Mon: Thu, Fri, Sat, Sun nights. Under "short" two of those four carry
  // the uplift; under "long" three do.
  const stay = {
    checkIn: "2026-07-30",
    checkOut: "2026-08-03",
    pricePerNight: 1000,
    weekendPrice: 1500,
    serviceFeePercent: 0,
    depositPercent: 30,
  } as const;

  it("uplifts two of four nights on a short weekend", () => {
    const q = quote({ ...stay, weekendMode: "short" });
    expect(q.breakdown.filter((n) => n.weekend)).toHaveLength(2);
    expect(q.subtotal).toBe(1000 + 1000 + 1500 + 1500);
  });

  it("uplifts three of four nights on a long weekend", () => {
    const q = quote({ ...stay, weekendMode: "long" });
    expect(q.breakdown.filter((n) => n.weekend)).toHaveLength(3);
    expect(q.subtotal).toBe(1000 + 1500 + 1500 + 1500);
  });

  /** The requirement in one line: the same stay, one uplift apart. */
  it("charges a long-weekend listing exactly one weekend night more", () => {
    const short = quote({ ...stay, weekendMode: "short" });
    const long = quote({ ...stay, weekendMode: "long" });
    expect(long.subtotal - short.subtotal).toBe(1500 - 1000);
  });

  /** The deposit is a share of the total, so the setting reaches all the way. */
  it("carries the difference through to the deposit", () => {
    const short = quote({ ...stay, weekendMode: "short" });
    const long = quote({ ...stay, weekendMode: "long" });
    expect(long.depositDue).toBeGreaterThan(short.depositDue);
  });
});

/* -------------------------------------------------------------------------- */
/* The calendar the guest actually sees                                       */
/* -------------------------------------------------------------------------- */

describe("buildMonthGrid weekend shading", () => {
  /**
   * A Sharjah listing that priced Friday at the weekend rate while leaving the
   * cell unshaded would be the page arguing with itself in front of the guest.
   */
  it("shades the days the listing's own mode charges for", () => {
    const shortGrid = buildMonthGrid(2026, 6, new Set(), "2026-07-01", "ar", "short");
    const longGrid = buildMonthGrid(2026, 6, new Set(), "2026-07-01", "ar", "long");

    const friday = (cells: ReturnType<typeof buildMonthGrid>) =>
      cells.find((c) => c.kind === "day" && c.iso === "2026-07-31");

    expect(friday(shortGrid)).toMatchObject({ isWeekend: false });
    expect(friday(longGrid)).toMatchObject({ isWeekend: true });
  });
});

/* -------------------------------------------------------------------------- */
/* The stored total — the number that is actually invoiced                    */
/* -------------------------------------------------------------------------- */

describe("createBookingRequest honours the listing's weekend", () => {
  /**
   * The browser's quote is a preview; this one is the invoice. If the action
   * ever stops reading `weekendMode` off the row, every Friday on every
   * long-weekend listing is silently undercharged and nothing fails loudly.
   */
  it("stores the long-weekend total for a Sharjah listing", async () => {
    const listing = await createListing({
      city: "sharjah",
      pricePerNight: 1000,
      weekendPrice: 1500,
      weekendMode: "long",
    });

    // Thursday → Saturday: Thursday night is a weekday, Friday night is a
    // weekend night on this listing and would not be on a Dubai one.
    const checkIn = futureThursday();

    const { createBookingRequest } = await import("@/app/actions/booking");
    const result = await createBookingRequest(
      bookingForm(listing.id, { checkIn, checkOut: addDays(checkIn, 2) }),
    );
    expect(result.ok).toBe(true);

    const booking = await prisma.bookingRequest.findFirst();
    expect(booking!.nights).toBe(2);
    expect(booking!.subtotal).toBe(1000 + 1500);
  });

  it("stores the short-weekend total for the identical stay elsewhere", async () => {
    const listing = await createListing({
      city: "dubai",
      pricePerNight: 1000,
      weekendPrice: 1500,
      weekendMode: "short",
    });
    const checkIn = futureThursday();

    const { createBookingRequest } = await import("@/app/actions/booking");
    await createBookingRequest(
      bookingForm(listing.id, { checkIn, checkOut: addDays(checkIn, 2) }),
    );

    const booking = await prisma.bookingRequest.findFirst();
    expect(booking!.subtotal).toBe(1000 + 1000);
  });

  /** A row holding nonsense must still be priced, and on the UAE weekend. */
  it("prices a listing with a corrupt mode as a short weekend", async () => {
    const listing = await createListing({
      pricePerNight: 1000,
      weekendPrice: 1500,
      weekendMode: "short",
    });
    await prisma.listing.update({
      where: { id: listing.id },
      data: { weekendMode: "whenever" },
    });
    const checkIn = futureThursday();

    const { createBookingRequest } = await import("@/app/actions/booking");
    const result = await createBookingRequest(
      bookingForm(listing.id, { checkIn, checkOut: addDays(checkIn, 2) }),
    );
    expect(result.ok).toBe(true);

    const booking = await prisma.bookingRequest.findFirst();
    expect(booking!.subtotal).toBe(2000);
  });
});

/* -------------------------------------------------------------------------- */
/* Per-listing stay policy                                                    */
/* -------------------------------------------------------------------------- */

const PLATFORM = {
  checkInTime: "٤ عصرًا",
  checkInTimeEn: "4 PM",
  checkOutTime: "١٢ ظهرًا",
  checkOutTimeEn: "12 noon",
  freeCancelHours: 48,
};

describe("resolveFreeCancelHours", () => {
  it("uses the listing's own window when it has one", () => {
    expect(resolveFreeCancelHours(24, 48)).toBe(24);
  });

  it("falls back to the platform's when the listing has none", () => {
    expect(resolveFreeCancelHours(null, 48)).toBe(48);
    expect(resolveFreeCancelHours(undefined, 48)).toBe(48);
  });

  /**
   * The trap. 0 is an owner saying "no free cancellation"; a truthiness check
   * turns that back into the platform's 48-hour promise, which the guest then
   * holds the owner to.
   */
  it("keeps an explicit 0 rather than treating it as unset", () => {
    expect(resolveFreeCancelHours(0, 48)).toBe(0);
    expect(resolveFreeCancelHours(0, 48)).not.toBe(48);
  });

  it("clamps a value that bypassed validation", () => {
    expect(resolveFreeCancelHours(-10, 48)).toBe(0);
    expect(resolveFreeCancelHours(10_000, 48)).toBe(720);
    expect(resolveFreeCancelHours(Number.NaN, 48)).toBe(48);
  });
});

describe("resolveStayTimes", () => {
  it("inherits both times when the listing sets neither", () => {
    const times = resolveStayTimes(
      { checkInTime: "", checkOutTime: "" },
      PLATFORM,
      "ar",
    );
    expect(times).toEqual({ checkInTime: "٤ عصرًا", checkOutTime: "١٢ ظهرًا" });
  });

  it("prefers the listing's own hours", () => {
    const times = resolveStayTimes(
      { checkInTime: "٣ عصرًا", checkOutTime: "١١ صباحًا" },
      PLATFORM,
      "ar",
    );
    expect(times).toEqual({ checkInTime: "٣ عصرًا", checkOutTime: "١١ صباحًا" });
  });

  it("overrides one side without disturbing the other", () => {
    const times = resolveStayTimes({ checkInTime: "٥ عصرًا" }, PLATFORM, "ar");
    expect(times.checkInTime).toBe("٥ عصرًا");
    expect(times.checkOutTime).toBe("١٢ ظهرًا");
  });

  it("uses the listing's English hour on the English site", () => {
    const times = resolveStayTimes(
      { checkInTime: "٣ عصرًا", checkInTimeEn: "3 PM" },
      PLATFORM,
      "en",
    );
    expect(times.checkInTime).toBe("3 PM");
  });

  /**
   * An owner who filled in the Arabic hour but not the English one gets their
   * Arabic hour on the English page — not the platform's. The platform's would
   * be a different venue's time, stated as fact; the Arabic one is at least
   * this venue's.
   */
  it("falls back to the listing's Arabic hour, not the platform's English one", () => {
    const times = resolveStayTimes(
      { checkInTime: "٣ عصرًا", checkInTimeEn: null },
      PLATFORM,
      "en",
    );
    expect(times.checkInTime).toBe("٣ عصرًا");
    expect(times.checkInTime).not.toBe("4 PM");
  });
});

describe("resolveListingPolicy", () => {
  it("resolves all three at once", () => {
    expect(
      resolveListingPolicy(
        { checkInTime: "٣ عصرًا", checkOutTime: "", freeCancelHours: 0 },
        PLATFORM,
        "ar",
      ),
    ).toEqual({
      checkInTime: "٣ عصرًا",
      checkOutTime: "١٢ ظهرًا",
      freeCancelHours: 0,
    });
  });

  /** A listing nobody has touched shows exactly the page it showed before. */
  it("reproduces the platform's terms for an untouched listing", () => {
    expect(
      resolveListingPolicy(
        { checkInTime: "", checkOutTime: "", freeCancelHours: null },
        PLATFORM,
        "ar",
      ),
    ).toEqual({
      checkInTime: "٤ عصرًا",
      checkOutTime: "١٢ ظهرًا",
      freeCancelHours: 48,
    });
  });
});

describe("platformPolicyFor", () => {
  it("gives the editor the default it is telling owners about", () => {
    expect(platformPolicyFor(PLATFORM, "ar")).toEqual({
      checkInTime: "٤ عصرًا",
      checkOutTime: "١٢ ظهرًا",
      freeCancelHours: 48,
    });
    expect(platformPolicyFor(PLATFORM, "en").checkInTime).toBe("4 PM");
  });
});

/* -------------------------------------------------------------------------- */
/* Round trip through the owner's own editor                                  */
/* -------------------------------------------------------------------------- */

/**
 * Through the REAL server action, not `prisma.listing.update`.
 *
 * The path that can actually break is FormData → `listingSchema` → the
 * `formData.get()` mapping → the `listingColumns` allow-list. A field missing
 * from any one of those four is dropped in silence: the owner picks the long
 * weekend, the form saves, the toast says success, and the row still says
 * "short". Writing the column with Prisma directly would test Prisma and pass
 * whether or not this feature was wired up at all.
 */
describe("saveOwnerListing stores the weekend and the policy", () => {
  function listingForm(overrides: Record<string, string> = {}) {
    const fd = new FormData();
    const base: Record<string, string> = {
      name: "Sharjah Rest House",
      description: "A description.",
      city: "sharjah",
      area: "Al Badayer",
      pricePerNight: "1000",
      weekendPrice: "1500",
      capacity: "50",
      lat: "25.3",
      lng: "55.5",
      depositPercent: "25",
      published: "on",
      ...overrides,
    };
    for (const [k, v] of Object.entries(base)) fd.set(k, v);
    return fd;
  }

  async function signedInOwner() {
    const { user } = await createOwner({ email: "sharjah@test.ae", status: "APPROVED" });
    sessionUser.current = { id: user.id };
  }

  it("saves the long weekend and the owner's own hours", async () => {
    await signedInOwner();

    const { saveOwnerListing } = await import("@/app/actions/listings");
    const result = await saveOwnerListing(
      listingForm({
        weekendMode: "long",
        checkInTime: "٣ عصرًا",
        checkInTimeEn: "3 PM",
        checkOutTime: "١١ صباحًا",
        freeCancelHours: "24",
      }),
    );
    expect(result.ok).toBe(true);

    const row = await prisma.listing.findFirst({ where: { name: "Sharjah Rest House" } });
    expect(row!.weekendMode).toBe("long");
    expect(row!.checkInTime).toBe("٣ عصرًا");
    expect(row!.checkInTimeEn).toBe("3 PM");
    expect(row!.checkOutTime).toBe("١١ صباحًا");
    expect(row!.freeCancelHours).toBe(24);
  });

  /**
   * The null/0 distinction, through the form this time. An empty box must reach
   * the database as NULL — `Number("")` is 0, and 0 would publish this owner as
   * refusing free cancellation on a form they never touched.
   */
  it("stores a blank cancellation window as null, not as zero", async () => {
    await signedInOwner();

    const { saveOwnerListing } = await import("@/app/actions/listings");
    await saveOwnerListing(listingForm({ freeCancelHours: "" }));

    const row = await prisma.listing.findFirst({ where: { name: "Sharjah Rest House" } });
    expect(row!.freeCancelHours).toBeNull();
    expect(resolveFreeCancelHours(row!.freeCancelHours, 48)).toBe(48);
  });

  it("stores a typed 0 as 0 — an owner who allows no free cancellation", async () => {
    await signedInOwner();

    const { saveOwnerListing } = await import("@/app/actions/listings");
    await saveOwnerListing(listingForm({ freeCancelHours: "0" }));

    const row = await prisma.listing.findFirst({ where: { name: "Sharjah Rest House" } });
    expect(row!.freeCancelHours).toBe(0);
    expect(resolveFreeCancelHours(row!.freeCancelHours, 48)).toBe(0);
  });

  /** Arabic-Indic digits, which is what an owner on an Arabic keyboard types. */
  it("understands ٢٤ as 24", async () => {
    await signedInOwner();

    const { saveOwnerListing } = await import("@/app/actions/listings");
    await saveOwnerListing(listingForm({ freeCancelHours: "٢٤" }));

    const row = await prisma.listing.findFirst({ where: { name: "Sharjah Rest House" } });
    expect(row!.freeCancelHours).toBe(24);
  });

  /** A form that never mentions any of this leaves the platform in charge. */
  it("defaults an untouched listing to the short weekend and inherited terms", async () => {
    await signedInOwner();

    const { saveOwnerListing } = await import("@/app/actions/listings");
    await saveOwnerListing(listingForm());

    const row = await prisma.listing.findFirst({ where: { name: "Sharjah Rest House" } });
    expect(row!.weekendMode).toBe("short");
    expect(row!.checkInTime).toBe("");
    expect(row!.checkInTimeEn).toBeNull();
    expect(row!.freeCancelHours).toBeNull();
  });

  /** A crafted post cannot store a mode the pricing does not understand. */
  it("refuses an unknown weekend mode rather than storing it", async () => {
    await signedInOwner();

    const { saveOwnerListing } = await import("@/app/actions/listings");
    await saveOwnerListing(listingForm({ weekendMode: "every-day" }));

    const row = await prisma.listing.findFirst({ where: { name: "Sharjah Rest House" } });
    expect(row!.weekendMode).toBe("short");
  });

  /**
   * The quote is what all of this is for. Save the long weekend through the
   * form, then price a Thursday→Saturday stay off the saved row: Friday night
   * carries the uplift because that is what the owner chose.
   */
  it("prices from the mode the form saved", async () => {
    await signedInOwner();

    const { saveOwnerListing } = await import("@/app/actions/listings");
    await saveOwnerListing(listingForm({ weekendMode: "long" }));

    const row = await prisma.listing.findFirst({ where: { name: "Sharjah Rest House" } });
    const checkIn = futureThursday();
    const q = quote({
      checkIn,
      checkOut: addDays(checkIn, 2),
      pricePerNight: row!.pricePerNight,
      weekendPrice: row!.weekendPrice,
      weekendMode: toWeekendMode(row!.weekendMode),
      serviceFeePercent: 0,
      depositPercent: 30,
    });
    expect(q.subtotal).toBe(1000 + 1500);
  });
});
