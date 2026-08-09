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
  resolveCancelPolicy,
  resolveDayUseCheckOut,
  resolveStayTimes,
  toCancelPolicy,
} from "@/lib/policies";

/**
 * Two things that used to have one platform-wide answer and now belong to the
 * individual rest house.
 *
 * ─── The weekend ─────────────────────────────────────────────────────────────
 * `isWeekend` was a constant, the same days for every listing. Nearly every
 * rest house fills on Friday and Saturday, but some — Sharjah's four-day
 * working week is the clearest case — are just as busy on Sunday and charge the
 * weekend rate for a third night. One constant either overcharges half the
 * catalogue or undercharges the other half; there is no value that is right for
 * both. So the weekend is a column on the listing.
 *
 * SUNDAY is the only day the two modes disagree about, so every case below that
 * means to tell them apart is built around a Sunday. A case built around Friday
 * would pass under both modes while proving nothing.
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

/** The next given weekday (0 = Sunday … 6 = Saturday) at least a week out. */
function futureDow(dow: number): string {
  let day = addDays(todayISO(), 7);
  while (dayOfWeek(day) !== dow) day = addDays(day, 1);
  return day;
}

/**
 * A Saturday, so that a two-night stay starting on it covers the Saturday night
 * both modes charge for AND the Sunday night only "long" does. Every stored-total
 * case below starts here: a Thursday→Saturday stay would produce the identical
 * total under both modes and pin nothing.
 */
const futureSaturday = () => futureDow(6);

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

  it("counts Friday and Saturday on a short weekend", () => {
    expect(isWeekend(FRI, "short")).toBe(true);
    expect(isWeekend(SAT, "short")).toBe(true);
  });

  /** The one day the two modes disagree about, which is the whole feature. */
  it("does not count Sunday on a short weekend", () => {
    expect(isWeekend(SUN, "short")).toBe(false);
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
  it("normalises anything unexpected to the short weekend", () => {
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
  // Thu → Mon: Thu, Fri, Sat, Sun nights. Deliberately spans a Sunday, the one
  // day the modes differ on — under "short" the Fri and Sat nights carry the
  // uplift, under "long" the Sunday one does too.
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
   * A long-weekend listing that priced Sunday at the weekend rate while leaving
   * the cell unshaded would be the page arguing with itself in front of the
   * guest. Sunday is the probe because it is the only day the modes differ on.
   */
  it("shades the days the listing's own mode charges for", () => {
    const shortGrid = buildMonthGrid(2026, 6, new Set(), "2026-07-01", "ar", "short");
    const longGrid = buildMonthGrid(2026, 6, new Set(), "2026-07-01", "ar", "long");

    const cell = (cells: ReturnType<typeof buildMonthGrid>, iso: string) =>
      cells.find((c) => c.kind === "day" && c.iso === iso);

    // 2026-07-26 is a Sunday, 2026-07-31 a Friday.
    expect(cell(shortGrid, "2026-07-26")).toMatchObject({ isWeekend: false });
    expect(cell(longGrid, "2026-07-26")).toMatchObject({ isWeekend: true });

    // Friday is shaded on both — the days they agree on must still be shaded.
    expect(cell(shortGrid, "2026-07-31")).toMatchObject({ isWeekend: true });
    expect(cell(longGrid, "2026-07-31")).toMatchObject({ isWeekend: true });
  });
});

/* -------------------------------------------------------------------------- */
/* The stored total — the number that is actually invoiced                    */
/* -------------------------------------------------------------------------- */

describe("createBookingRequest honours the listing's weekend", () => {
  /**
   * The browser's quote is a preview; this one is the invoice. If the action
   * ever stops reading `weekendMode` off the row, every Sunday on every
   * long-weekend listing is silently undercharged and nothing fails loudly.
   */
  it("stores the long-weekend total for a Sharjah listing", async () => {
    const listing = await createListing({
      city: "sharjah",
      pricePerNight: 1000,
      weekendPrice: 1500,
      weekendMode: "long",
    });

    // Saturday → Monday: Saturday night is a weekend night everywhere, Sunday
    // night is one on this listing and would not be on a Dubai one.
    const checkIn = futureSaturday();

    const { createBookingRequest } = await import("@/app/actions/booking");
    const result = await createBookingRequest(
      bookingForm(listing.id, { checkIn, checkOut: addDays(checkIn, 2) }),
    );
    expect(result.ok).toBe(true);

    const booking = await prisma.bookingRequest.findFirst();
    expect(booking!.nights).toBe(2);
    expect(booking!.subtotal).toBe(1500 + 1500);
  });

  it("stores the short-weekend total for the identical stay elsewhere", async () => {
    const listing = await createListing({
      city: "dubai",
      pricePerNight: 1000,
      weekendPrice: 1500,
      weekendMode: "short",
    });
    const checkIn = futureSaturday();

    const { createBookingRequest } = await import("@/app/actions/booking");
    await createBookingRequest(
      bookingForm(listing.id, { checkIn, checkOut: addDays(checkIn, 2) }),
    );

    const booking = await prisma.bookingRequest.findFirst();
    expect(booking!.subtotal).toBe(1500 + 1000);
  });

  /** A row holding nonsense must still be priced, and on the short weekend. */
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
    const checkIn = futureSaturday();

    const { createBookingRequest } = await import("@/app/actions/booking");
    const result = await createBookingRequest(
      bookingForm(listing.id, { checkIn, checkOut: addDays(checkIn, 2) }),
    );
    expect(result.ok).toBe(true);

    const booking = await prisma.bookingRequest.findFirst();
    expect(booking!.subtotal).toBe(1500 + 1000);
  });
});

/* -------------------------------------------------------------------------- */
/* Per-listing stay policy                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A settings row that has been through the hour migration: it carries hours
 * AND the free text they superseded, which is exactly the state the migration
 * leaves a seeded install in. Keeping both lets the tests below pin the tier
 * order rather than merely the happy path — if the hour ever stopped winning
 * here, the expectations would quietly fall back to "٤ عصرًا" and still read
 * like plausible output.
 */
const PLATFORM = {
  checkInHour: 16,
  checkOutHour: 12,
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

describe("resolveCancelPolicy", () => {
  /**
   * Six answers from a list, replacing "any integer 0…720 typed into a box".
   *
   * The interesting one is ASK: it is not a number of hours, and the obvious
   * encoding for it (-1) is destroyed by `clampHours`, which floors at 0. That
   * would publish "no free cancellation" — a refusal — on behalf of an owner
   * who said "talk to me". Hence a named mode and a tagged result, so no call
   * site can accidentally read "ask" as a quantity.
   */
  it("returns the window for each of the four hour policies", () => {
    const cases = [
      ["H24", 24],
      ["H48", 48],
      ["H72", 72],
      ["H120", 120],
    ] as const;
    for (const [id, hours] of cases) {
      expect(resolveCancelPolicy({ cancelPolicy: id }, PLATFORM)).toEqual({
        kind: "hours",
        hours,
      });
    }
  });

  it("distinguishes 'no free cancellation' from 'ask the owner'", () => {
    expect(resolveCancelPolicy({ cancelPolicy: "NONE" }, PLATFORM)).toEqual({ kind: "none" });
    expect(resolveCancelPolicy({ cancelPolicy: "ASK" }, PLATFORM)).toEqual({ kind: "ask" });
  });

  /**
   * The sentinel trap, pinned directly. If ASK ever goes back to being a number
   * it will land here first: `clampHours(-1)` is 0, and 0 is NONE.
   */
  it("never collapses 'ask the owner' into 'no free cancellation'", () => {
    const asked = resolveCancelPolicy({ cancelPolicy: "ASK" }, PLATFORM);
    expect(asked.kind).not.toBe("none");
    expect(asked.kind).not.toBe("hours");
  });

  /* ─── tier 2 and 3: rows nobody has converted ───────────────────────────── */

  it("inherits the platform window when the listing has chosen nothing", () => {
    expect(resolveCancelPolicy({}, PLATFORM)).toEqual({ kind: "hours", hours: 48 });
  });

  /**
   * The non-breaking guarantee. A listing still carrying the old number keeps
   * advertising that number — including the awkward ones no mode covers, which
   * is precisely why the migration converted nothing.
   */
  it("still reads the old freeCancelHours, including values no mode covers", () => {
    expect(resolveCancelPolicy({ freeCancelHours: 36 }, PLATFORM)).toEqual({
      kind: "hours",
      hours: 36,
    });
  });

  /**
   * null vs 0 survives the new column: null inherits, 0 is a refusal the owner
   * made. Collapsing them would publish a 48-hour promise for an owner who
   * explicitly allowed none.
   */
  it("keeps null-inherits and zero-refuses apart on the legacy number", () => {
    expect(resolveCancelPolicy({ freeCancelHours: null }, PLATFORM)).toEqual({
      kind: "hours",
      hours: 48,
    });
    expect(resolveCancelPolicy({ freeCancelHours: 0 }, PLATFORM)).toEqual({ kind: "none" });
  });

  it("prefers a chosen mode over a leftover number on the same listing", () => {
    const resolved = resolveCancelPolicy({ cancelPolicy: "ASK", freeCancelHours: 36 }, PLATFORM);
    expect(resolved).toEqual({ kind: "ask" });
  });

  /** A crafted post or a stale tab must inherit, not publish some other answer. */
  it("treats an unrecognised mode as 'nothing chosen'", () => {
    expect(resolveCancelPolicy({ cancelPolicy: "SOMEDAY" }, PLATFORM)).toEqual({
      kind: "hours",
      hours: 48,
    });
    expect(toCancelPolicy("SOMEDAY")).toBeNull();
    expect(toCancelPolicy("")).toBeNull();
  });
});

describe("resolveStayTimes", () => {
  /**
   * Three tiers, and the whole suite below is about which one wins.
   *
   *   1. the listing's own hour        — picked from the menu
   *   2. the listing's own legacy text — typed, before the menu existed
   *   3. the platform's answer         — tiers 1 and 2 on the settings row
   *
   * ─── What happened to the Arabic-set-English-blank case ───────────────────
   * There used to be a test here pinning "an owner who filled the Arabic box
   * but not the English one gets their Arabic hour on the English page". It is
   * gone rather than rewritten, because under a stored hour the situation it
   * described cannot arise: one number renders correctly in both languages, so
   * there is no half-filled pair left to have a rule about. The rule itself is
   * NOT gone — it still governs tier 2, and the "legacy text" cases below are
   * where it is now pinned, because un-migrated rows still hit exactly it.
   */
  it("inherits both times when the listing sets neither", () => {
    const times = resolveStayTimes({}, PLATFORM, "ar");
    expect(times).toEqual({ checkInTime: "٤:٠٠ مساءً", checkOutTime: "١٢:٠٠ ظهرًا" });
  });

  it("renders the same stored hour in each language", () => {
    const listing = { checkInHour: 15, checkOutHour: 11 };
    expect(resolveStayTimes(listing, PLATFORM, "ar")).toEqual({
      checkInTime: "٣:٠٠ مساءً",
      checkOutTime: "١١:٠٠ صباحًا",
    });
    expect(resolveStayTimes(listing, PLATFORM, "en")).toEqual({
      checkInTime: "3:00 PM",
      checkOutTime: "11:00 AM",
    });
  });

  it("overrides one side without disturbing the other", () => {
    const times = resolveStayTimes({ checkInHour: 17 }, PLATFORM, "ar");
    expect(times.checkInTime).toBe("٥:٠٠ مساءً");
    expect(times.checkOutTime).toBe("١٢:٠٠ ظهرًا");
  });

  /**
   * Midnight is 0, and 0 is falsy. Every tier in this chain is stacked with
   * `||`, so a naive implementation drops straight past a listing that closes
   * at midnight and prints the platform's noon instead — turning a twelve-hour
   * difference into a silent one. This is the case that makes `isStayHour`
   * necessary rather than a truthiness check.
   */
  it("treats midnight as a real answer rather than as unset", () => {
    const times = resolveStayTimes({ checkOutHour: 0 }, PLATFORM, "ar");
    expect(times.checkOutTime).toBe("١٢:٠٠ منتصف الليل");
    expect(times.checkOutTime).not.toBe("١٢:٠٠ ظهرًا");
  });

  it("uses the platform's stored hour when it has one", () => {
    const platform = { ...PLATFORM, checkInHour: 14 };
    expect(resolveStayTimes({}, platform, "en").checkInTime).toBe("2:00 PM");
  });

  /* ─── tier 2: rows nobody has migrated ──────────────────────────────────── */

  /**
   * The non-breaking guarantee, stated as a test: a listing still holding the
   * text an owner typed renders that text, not a converted guess and not the
   * platform's hour. If this fails, the migration silently rewrote what a rest
   * house advertises.
   */
  it("still renders a listing's legacy free text when it has no hour", () => {
    const times = resolveStayTimes({ checkInTime: "بعد العصر" }, PLATFORM, "ar");
    expect(times.checkInTime).toBe("بعد العصر");
  });

  it("prefers a stored hour over leftover text on the same field", () => {
    const times = resolveStayTimes(
      { checkInHour: 15, checkInTime: "بعد العصر" },
      PLATFORM,
      "ar",
    );
    expect(times.checkInTime).toBe("٣:٠٠ مساءً");
  });

  /**
   * The rule the deleted test used to guard, now living where it still applies.
   * An un-migrated listing with Arabic text and no English shows its Arabic on
   * the English page — the platform's hour would be a different venue's time
   * stated as fact, where the Arabic one is at least this venue's.
   */
  it("falls back to a listing's Arabic text, not the platform's, on the English site", () => {
    const times = resolveStayTimes(
      { checkInTime: "٣ عصرًا", checkInTimeEn: null },
      PLATFORM,
      "en",
    );
    expect(times.checkInTime).toBe("٣ عصرًا");
    expect(times.checkInTime).not.toBe("4:00 PM");
  });

  /**
   * The platform half of the non-breaking guarantee: an operator who has not
   * opened the new menu keeps their own wording on every listing that inherits.
   */
  it("uses the platform's legacy text when the platform has no hour", () => {
    const unmigrated = { ...PLATFORM, checkInHour: null, checkOutHour: null };
    expect(resolveStayTimes({}, unmigrated, "ar").checkInTime).toBe("٤ عصرًا");
    expect(resolveStayTimes({}, unmigrated, "en").checkInTime).toBe("4 PM");
  });

  /** A settings row cleared to nothing still has to print something sane. */
  it("falls back to the platform default when every tier is empty", () => {
    const empty = { checkInTime: "", checkOutTime: "", freeCancelHours: 48 };
    expect(resolveStayTimes({}, empty, "en")).toEqual({
      checkInTime: "4:00 PM",
      checkOutTime: "12:00 noon",
    });
  });
});

describe("resolveDayUseCheckOut", () => {
  /**
   * The one stay time with NO platform tier, and the reason it is a separate
   * function. Unset here means "this rest house does not take day bookings" —
   * which is most of the catalogue — not "use the platform's hour". Give it a
   * fallback and every overnight-only listing starts advertising a leave-by
   * time for a booking it does not accept.
   */
  it("returns nothing when the listing offers no day booking", () => {
    expect(resolveDayUseCheckOut({}, "ar")).toBe("");
    expect(resolveDayUseCheckOut({ dayUseCheckOutHour: null }, "en")).toBe("");
  });

  it("renders the stored hour in each language", () => {
    expect(resolveDayUseCheckOut({ dayUseCheckOutHour: 22 }, "ar")).toBe("١٠:٠٠ مساءً");
    expect(resolveDayUseCheckOut({ dayUseCheckOutHour: 22 }, "en")).toBe("10:00 PM");
  });

  it("still renders legacy text on a listing with no hour", () => {
    expect(resolveDayUseCheckOut({ dayUseCheckOutTime: "١٠ مساءً" }, "ar")).toBe("١٠ مساءً");
  });
});

describe("platformPolicyFor", () => {
  it("gives the editor the default it is telling owners about", () => {
    expect(platformPolicyFor(PLATFORM, "ar")).toEqual({
      checkInTime: "٤:٠٠ مساءً",
      checkOutTime: "١٢:٠٠ ظهرًا",
      freeCancelHours: 48,
    });
    expect(platformPolicyFor(PLATFORM, "en").checkInTime).toBe("4:00 PM");
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
        checkInHour: "15",
        checkOutHour: "11",
        cancelPolicy: "H24",
      }),
    );
    expect(result.ok).toBe(true);

    const row = await prisma.listing.findFirst({ where: { name: "Sharjah Rest House" } });
    expect(row!.weekendMode).toBe("long");
    expect(row!.checkInHour).toBe(15);
    expect(row!.checkOutHour).toBe(11);
    expect(row!.cancelPolicy).toBe("H24");
  });

  /**
   * Midnight through the form, which is where it is most likely to be lost:
   * the field arrives as the string "0", and anything treating that as "empty"
   * stores null and hands the listing back to the platform's noon.
   */
  it("saves a midnight checkout as 0, not as unset", async () => {
    await signedInOwner();

    const { saveOwnerListing } = await import("@/app/actions/listings");
    await saveOwnerListing(listingForm({ checkOutHour: "0" }));

    const row = await prisma.listing.findFirst({ where: { name: "Sharjah Rest House" } });
    expect(row!.checkOutHour).toBe(0);
  });

  /**
   * Picking an hour retires the free text that used to answer for that field,
   * so the legacy tier drains as owners touch their listings. Only the field
   * that gained an hour is cleared — the other keeps its text and keeps
   * rendering it.
   */
  it("clears the legacy text for the field that gained an hour, and only that one", async () => {
    await signedInOwner();
    const { owner } = await createOwner({ email: "legacy@test.ae", status: "APPROVED" });
    sessionUser.current = { id: (await prisma.user.findFirstOrThrow({
      where: { ownerProfile: { id: owner.id } },
    })).id };

    const listing = await createListing({
      ownerId: owner.id,
      checkInTime: "بعد العصر",
      checkOutTime: "١١ صباحًا",
    });

    const { saveOwnerListing } = await import("@/app/actions/listings");
    const form = listingForm({ checkInHour: "15" });
    form.set("id", listing.id);
    form.set("name", listing.name);
    const result = await saveOwnerListing(form);
    expect(result.ok).toBe(true);

    const row = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(row.checkInHour).toBe(15);
    expect(row.checkInTime).toBe("");
    // Untouched: still no hour, still its own words, still what the page shows.
    expect(row.checkOutHour).toBeNull();
    expect(row.checkOutTime).toBe("١١ صباحًا");
  });

  /**
   * ─── Where the old freeCancelHours form tests went ────────────────────────
   * Three tests here used to post `freeCancelHours` as text: blank-is-not-zero,
   * typed-zero-is-a-refusal, and Arabic-digits-parse. The form no longer has
   * that box, so posting it proved nothing about the form. Each guarantee moved
   * rather than being dropped:
   *
   *   blank ≠ zero    → "leaves an untouched listing inheriting, not refusing"
   *                     above, and the null/0 unit tests in `resolveCancelPolicy`
   *   typed 0         → the "NONE" case of the same pair
   *   Arabic digits   → the hour menu below, which is the only numeric field an
   *                     owner still types into via `normalizeDigits`
   *
   * The one thing genuinely gone is the ability to store 37 hours from the
   * form, which was the problem being solved.
   */
  it("normalises Arabic-Indic digits on the hour menu", async () => {
    await signedInOwner();

    const { saveOwnerListing } = await import("@/app/actions/listings");
    await saveOwnerListing(listingForm({ checkInHour: "١٦" }));

    const row = await prisma.listing.findFirst({ where: { name: "Sharjah Rest House" } });
    expect(row!.checkInHour).toBe(16);
  });

  /** A form that never mentions any of this leaves the platform in charge. */
  it("defaults an untouched listing to the short weekend and inherited terms", async () => {
    await signedInOwner();

    const { saveOwnerListing } = await import("@/app/actions/listings");
    await saveOwnerListing(listingForm());

    const row = await prisma.listing.findFirst({ where: { name: "Sharjah Rest House" } });
    expect(row!.weekendMode).toBe("short");
    expect(row!.checkInHour).toBeNull();
    expect(row!.checkOutHour).toBeNull();
    expect(row!.dayUseCheckOutHour).toBeNull();
    expect(row!.checkInTime).toBe("");
    expect(row!.freeCancelHours).toBeNull();
  });

  /**
   * The same round-trip through the ADMIN save path.
   *
   * Not redundant with the owner test above: `saveListing` and
   * `saveOwnerListing` fetch the legacy text through different calls —
   * `legacyStayTextFor(id)` against `legacyStayTextFor(id, owner.id)` — and it
   * is the fetch, not the write, that decides whether an un-migrated listing
   * keeps its own words or has them blanked. A regression in one would not show
   * up in the other.
   */
  it("preserves and retires legacy text the same way when an admin saves", async () => {
    const admin = await prisma.user.create({
      data: { email: "operator-hours@example.ae", passwordHash: "x", role: "ADMIN" },
    });
    sessionUser.current = { id: admin.id };

    const listing = await createListing({
      checkInTime: "بعد العصر",
      checkOutTime: "١١ صباحًا",
      dayUseCheckOutTime: "١٠ مساءً",
    });

    const { saveListing } = await import("@/app/actions/listings");
    const form = listingForm({ checkInHour: "15" });
    form.set("id", listing.id);
    form.set("name", listing.name);
    const result = await saveListing(form);
    expect(result.ok).toBe(true);

    const row = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(row.checkInHour).toBe(15);
    expect(row.checkInTime).toBe("");
    // The two nobody touched keep their text — a save must not blank a field
    // just because the form stopped rendering it.
    expect(row.checkOutTime).toBe("١١ صباحًا");
    expect(row.dayUseCheckOutTime).toBe("١٠ مساءً");
  });

  /**
   * The cancellation list through the form. "NONE" and "" are the pair that
   * must not blur: one is an owner refusing free cancellation, the other is a
   * listing that has not been asked yet and still inherits.
   */
  it("stores a chosen cancellation policy, and keeps NONE distinct from unset", async () => {
    await signedInOwner();
    const { saveOwnerListing } = await import("@/app/actions/listings");

    await saveOwnerListing(listingForm({ cancelPolicy: "ASK" }));
    let row = await prisma.listing.findFirstOrThrow({ where: { name: "Sharjah Rest House" } });
    expect(row.cancelPolicy).toBe("ASK");
    expect(resolveCancelPolicy(row, { freeCancelHours: 48 })).toEqual({ kind: "ask" });

    const form = listingForm({ cancelPolicy: "NONE" });
    form.set("id", row.id);
    await saveOwnerListing(form);
    row = await prisma.listing.findUniqueOrThrow({ where: { id: row.id } });
    expect(row.cancelPolicy).toBe("NONE");
    expect(resolveCancelPolicy(row, { freeCancelHours: 48 })).toEqual({ kind: "none" });
  });

  it("leaves an untouched listing inheriting, not refusing", async () => {
    await signedInOwner();
    const { saveOwnerListing } = await import("@/app/actions/listings");
    await saveOwnerListing(listingForm());

    const row = await prisma.listing.findFirstOrThrow({ where: { name: "Sharjah Rest House" } });
    expect(row.cancelPolicy).toBe("");
    expect(resolveCancelPolicy(row, { freeCancelHours: 48 })).toEqual({ kind: "hours", hours: 48 });
  });

  /**
   * The old number is not posted by the form any more, so a save must carry it
   * through rather than default it away — it is what an un-converted listing
   * still advertises.
   */
  it("preserves a legacy freeCancelHours across a save that does not mention it", async () => {
    const { owner } = await createOwner({ email: "legacy-cancel@test.ae", status: "APPROVED" });
    const user = await prisma.user.findFirstOrThrow({ where: { ownerProfile: { id: owner.id } } });
    sessionUser.current = { id: user.id };

    const listing = await createListing({ ownerId: owner.id, freeCancelHours: 36 });

    const { saveOwnerListing } = await import("@/app/actions/listings");
    const form = listingForm();
    form.set("id", listing.id);
    form.set("name", listing.name);
    expect((await saveOwnerListing(form)).ok).toBe(true);

    const row = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(row.freeCancelHours).toBe(36);
    expect(resolveCancelPolicy(row, { freeCancelHours: 48 })).toEqual({ kind: "hours", hours: 36 });
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
   * form, then price a Saturday→Monday stay off the saved row: Sunday night
   * carries the uplift because that is what the owner chose, and on "short" it
   * would not.
   */
  it("prices from the mode the form saved", async () => {
    await signedInOwner();

    const { saveOwnerListing } = await import("@/app/actions/listings");
    await saveOwnerListing(listingForm({ weekendMode: "long" }));

    const row = await prisma.listing.findFirst({ where: { name: "Sharjah Rest House" } });
    const checkIn = futureSaturday();
    const q = quote({
      checkIn,
      checkOut: addDays(checkIn, 2),
      pricePerNight: row!.pricePerNight,
      weekendPrice: row!.weekendPrice,
      weekendMode: toWeekendMode(row!.weekendMode),
      serviceFeePercent: 0,
      depositPercent: 30,
    });
    expect(q.subtotal).toBe(1500 + 1500);
  });
});
