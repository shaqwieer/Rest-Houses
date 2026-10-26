import { isWeekend, nightsInRange, type ISODate, type WeekendMode } from "./dates";
import { DEPOSIT_PERCENT_MAX, DEPOSIT_PERCENT_MIN, MULTI_NIGHT_MIN_NIGHTS } from "./constants";

/**
 * Quote calculation — the single place a total is computed.
 *
 * Both the listing sidebar and the booking form call this, so the number the
 * guest sees on the detail page is by construction the number saved with the
 * request and quoted in the WhatsApp message. Amounts are whole dirhams.
 *
 * ─── Authority ───────────────────────────────────────────────────────────────
 * The browser calling this is producing a *preview*. The value that is stored,
 * invoiced and messaged is always the one produced by the call inside
 * `createBookingRequest` (src/app/actions/booking.ts), which re-reads the
 * listing's price, the platform's service fee and the listing's deposit rate
 * from the database and ignores every number the form submitted. A total in a
 * hidden field is trivially editable; nothing here trusts one.
 */

/**
 * One night marked as an occasion: its name, and its own rate when it has one.
 *
 * `price` is `SpecialDay.price` — New Year's Eve at 8,000 on a listing whose
 * `holidayPrice` is 5,000. null (or 0) means the night has no rate of its own
 * and takes the listing's `holidayPrice`, which is what every day marked before
 * the column existed, and every copy of a platform-wide holiday, resolves to.
 */
export type SpecialDayInfo = {
  label: string;
  price?: number | null;
};

/** The marked nights of a listing, by date. See `getSpecialDays` in src/lib/listings.ts. */
export type SpecialDays = ReadonlyMap<ISODate, SpecialDayInfo>;

export type QuoteInput = {
  checkIn: ISODate;
  checkOut: ISODate;
  pricePerNight: number;
  /** Weekend rate. 0 or missing → same as pricePerNight. */
  weekendPrice?: number | null;
  /**
   * Which days that weekend rate applies to — the listing's own `weekendMode`.
   *
   * Required, not optional with a default. Four places quote a stay (the
   * sidebar, the booking page, the server action that stores the total, and
   * `verify.ts`), and only the third one's number is real money; an optional
   * field would let it be forgotten there and silently undercharge every
   * Friday on a Sharjah listing. See `isWeekend` in src/lib/dates.ts.
   */
  weekendMode: WeekendMode;
  /** Occasion rate. 0 or missing → special days fall back to the normal rules. */
  holidayPrice?: number | null;
  /**
   * The rates for a stay of `MULTI_NIGHT_MIN_NIGHTS` nights or more — weekday
   * and weekend. 0 or missing → not offered. See `nightRate` for the fallback.
   *
   * Optional, unlike `weekendMode`, because leaving them out can only ever
   * quote the full price. The stored total is still pinned to the database by
   * a test in tests/special-pricing.test.ts, so the server action cannot quietly
   * quote a different figure from the preview.
   */
  multiNightPrice?: number | null;
  multiNightWeekendPrice?: number | null;
  /**
   * The nights this listing has marked as a big occasion — Eid, National Day,
   * New Year — each mapped to the occasion's name and its own rate, if any.
   *
   * A Set would have done for pricing alone; a Map carries the label so a guest
   * can be told *why* a night costs more instead of being shown an unexplained
   * figure. An empty map (the default) prices exactly as before this existed.
   *
   * ─── This is authoritative only on the server ────────────────────────────
   * Same rule as every other input here, and worth restating because this one
   * is the easiest to get wrong: the copy passed by `booking-context.tsx` is a
   * preview. `createBookingRequest` loads the marked days from the database
   * itself, for that listing and that range, and ignores anything the form
   * sent — otherwise a guest could book Eid at the weekday rate by editing a
   * hidden field. See the note at the top of this file.
   */
  specialDays?: SpecialDays;
  serviceFeePercent: number;
  /** Already resolved through `resolveDepositPercent` — 0..100. */
  depositPercent: number;

  /**
   * A day-use stay (حجز بدون مبيت): the guest arrives and leaves the same day.
   *
   * When true, `checkOut` is expected to equal `checkIn` and the two day rates
   * below are used instead of the nightly ones. The result carries `nights: 0`,
   * which is the honest number — there are none.
   */
  dayUse?: boolean;
  /** Weekday day-use rate. 0 means the listing does not offer day use. */
  dayUsePrice?: number | null;
  /** Weekend day-use rate. 0 or missing → no day use on weekend days. */
  dayUseWeekendPrice?: number | null;
};

export type Quote = {
  nights: number;
  subtotal: number;
  serviceFee: number;
  total: number;
  /** Deposit the owner will ask for on confirmation. */
  depositDue: number;
  /** The rate that produced `depositDue`, carried through for the snapshot. */
  depositPercent: number;
  /**
   * Whether this quote priced a day-use stay.
   *
   * Carried on the result so a consumer never has to infer it from
   * `nights === 0` — which is also what an *invalid* range produces, and the two
   * mean opposite things: one is a real booking priced at the day rate, the
   * other is nothing at all.
   */
  dayUse: boolean;
  /**
   * What the multi-night rate took off this stay, against pricing each of its
   * nights on its own. 0 when the stay is too short or the listing offers no
   * such rate — the price card shows its line only when this is not 0.
   */
  multiNightSavings: number;
  /**
   * Per-night breakdown, so a weekend or occasion uplift can be shown.
   *
   * `special` carries the occasion's name when the night was charged at the
   * holiday rate, and is absent otherwise. A night can be both a weekend and an
   * occasion; `special` winning is what the rate did too, so a reader of the
   * breakdown never sees a "weekend" label on a night charged at the Eid rate.
   *
   * `multiNight` is set on a night charged at the multi-night rate.
   */
  breakdown: {
    date: ISODate;
    amount: number;
    weekend: boolean;
    special?: string;
    multiNight?: boolean;
  }[];
};

/**
 * What one night costs — the single place the price tiers are ordered.
 *
 *     marked as an occasion, with a price of its own   → that day's price
 *     marked as an occasion, and holidayPrice is set   → holidayPrice
 *     a stay of 2+ nights, with a multi-night rate set → the multi-night rate
 *     a weekend night, and weekendPrice is set         → weekendPrice
 *     otherwise                                        → pricePerNight
 *
 * The occasion rate outranks the weekend rate because Eid falling on a Saturday
 * is still Eid; the other order would quietly charge the lower of the two on
 * precisely the nights demand is highest. For the same reason it outranks the
 * multi-night rate: a guest staying New Year's Eve and the night after gets the
 * long-stay rate on the second night, not on the first. The occasion night
 * still counts towards the two.
 *
 * Each tier requires its own rate to be greater than zero — 0 means "not
 * offered" throughout this schema, and treating it as a price would make a
 * listing that never set a holiday rate suddenly free on the marked days.
 *
 * Which multi-night figure a night takes is `multiNightRate` below, and the
 * tier is only ever a discount: a multi-night rate at or above the night's
 * regular one is ignored rather than charged.
 *
 * `stayNights` is the length of the whole stay. It defaults to 1 — the night
 * priced on its own — which is what the calendar shows before a range exists.
 *
 * Exported so the calendar can show a guest the per-night figure without
 * rebuilding a whole quote.
 */
export function nightRate(
  listing: {
    pricePerNight: number;
    weekendPrice?: number | null;
    holidayPrice?: number | null;
    multiNightPrice?: number | null;
    multiNightWeekendPrice?: number | null;
    weekendMode: WeekendMode;
  },
  date: ISODate,
  specialDays?: SpecialDays,
  stayNights = 1,
): { amount: number; weekend: boolean; special?: string; multiNight?: boolean } {
  const weekend = isWeekend(date, listing.weekendMode);
  const occasion = specialDays?.get(date);

  if (occasion !== undefined) {
    const own = occasion.price ?? 0;
    const rate = own > 0 ? own : (listing.holidayPrice ?? 0);
    if (rate > 0) return { amount: rate, weekend, special: occasion.label };
  }

  const weekendRate = listing.weekendPrice ?? 0;
  const regular = weekend && weekendRate > 0 ? weekendRate : listing.pricePerNight;

  if (stayNights >= MULTI_NIGHT_MIN_NIGHTS) {
    const long = multiNightRate(listing, weekend);
    if (long > 0 && long < regular) return { amount: long, weekend, multiNight: true };
  }

  return { amount: regular, weekend };
}

/**
 * The multi-night figure for one night, or 0 when this night has none.
 *
 *     weekday night                                    → multiNightPrice
 *     weekend night, multiNightWeekendPrice set        → multiNightWeekendPrice
 *     weekend night, listing has its own weekend rate  → 0 — no discount
 *     weekend night, weekend priced as a weekday       → multiNightPrice
 *
 * The third line is the one that matters. An owner charging 1,400 at the
 * weekend who sets only an 800 weekday long-stay rate has said nothing about
 * weekends, and falling back to 800 there would hand out a 600-dirham discount
 * on the busiest nights. The fourth line is the same rule from the other side:
 * a listing with no weekend rate prices a Saturday as a Tuesday, so it gets the
 * Tuesday long-stay rate too.
 *
 * Exported so the listing editor's hint and the page's offer line can say
 * which weekend figure a guest will actually be charged.
 */
export function multiNightRate(
  listing: {
    weekendPrice?: number | null;
    multiNightPrice?: number | null;
    multiNightWeekendPrice?: number | null;
  },
  weekend: boolean,
): number {
  const weekday = listing.multiNightPrice ?? 0;
  if (!weekend) return weekday;

  const weekendLong = listing.multiNightWeekendPrice ?? 0;
  if (weekendLong > 0) return weekendLong;

  return (listing.weekendPrice ?? 0) > 0 ? 0 : weekday;
}

/**
 * The long-stay rates a guest will actually be charged, for advertising the
 * offer on the listing page — weekday and weekend, 0 where a night gets none.
 * null when the listing offers neither, so the page renders nothing.
 *
 * Built from `multiNightRate` and the same "only ever a discount" test as
 * `nightRate`, so the figure advertised is never one the quote then declines
 * to charge.
 */
export function multiNightOffer(listing: {
  pricePerNight: number;
  weekendPrice?: number | null;
  multiNightPrice?: number | null;
  multiNightWeekendPrice?: number | null;
}): { weekday: number; weekend: number } | null {
  const weekendRegular =
    (listing.weekendPrice ?? 0) > 0 ? listing.weekendPrice! : listing.pricePerNight;
  const weekdayLong = multiNightRate(listing, false);
  const weekendLong = multiNightRate(listing, true);

  const weekday = weekdayLong > 0 && weekdayLong < listing.pricePerNight ? weekdayLong : 0;
  const weekend = weekendLong > 0 && weekendLong < weekendRegular ? weekendLong : 0;
  return weekday > 0 || weekend > 0 ? { weekday, weekend } : null;
}

/**
 * Which day-use rate applies on a given date, or 0 when day use is not offered.
 *
 * Exported because both the quote and the server-side guard in
 * `createBookingRequest` need the same answer: the guard refuses a day-use
 * request on a listing whose rate is 0, and it must ask the question exactly the
 * way the pricing does or the two can disagree about whether a booking is free.
 *
 * The weekend rate does NOT fall back to the weekday one. An owner who types 0
 * for the weekend is saying the rest house takes no day bookings on those days
 * — the weekend is when it sells whole nights — and quoting the weekday figure
 * there instead turned that into a Friday booked at the Tuesday price. This is
 * the opposite of `weekendPrice` in `nightRate`, where 0 does mean "same as the
 * weekday rate": a night always has a price, a day booking need not exist.
 */
export function dayUseRate(
  listing: {
    dayUsePrice?: number | null;
    dayUseWeekendPrice?: number | null;
    /** The listing's own weekend — Sharjah's Friday is a weekend day. */
    weekendMode: WeekendMode;
  },
  date: ISODate,
): number {
  const base = listing.dayUsePrice ?? 0;
  if (base <= 0) return 0; // not offered — see Listing.dayUsePrice in the schema

  if (!isWeekend(date, listing.weekendMode)) return base;

  const weekendRate = listing.dayUseWeekendPrice ?? 0;
  return weekendRate > 0 ? weekendRate : 0; // 0 → no day use on the weekend
}

/**
 * Which deposit rate applies to a listing.
 *
 * `Listing.depositPercent` is nullable, and null and 0 mean genuinely different
 * things:
 *   null → "I haven't set one; use the platform default"
 *   0    → "I require no deposit"
 * A truthiness check (`listing.depositPercent || settings.depositPercent`)
 * collapses those two, silently turning every no-deposit listing into one that
 * charges the platform default. Hence the explicit null/undefined test.
 *
 * The result is clamped to 0..100 so a value that somehow bypassed validation —
 * an old row, a direct database edit — can never produce a negative deposit or
 * one larger than the booking itself.
 */
export function resolveDepositPercent(
  listingDepositPercent: number | null | undefined,
  platformDefault: number,
): number {
  const raw =
    listingDepositPercent === null || listingDepositPercent === undefined
      ? platformDefault
      : listingDepositPercent;

  if (!Number.isFinite(raw)) return clampPercent(platformDefault);
  return clampPercent(raw);
}

/** Clamp to the valid percentage range and drop any fractional part. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return DEPOSIT_PERCENT_MIN;
  return Math.min(DEPOSIT_PERCENT_MAX, Math.max(DEPOSIT_PERCENT_MIN, Math.round(value)));
}

/** Is this a percentage a listing may store? Used by the server-side schemas. */
export function isValidDepositPercent(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= DEPOSIT_PERCENT_MIN &&
    value <= DEPOSIT_PERCENT_MAX
  );
}

export function quote(input: QuoteInput): Quote {
  const {
    checkIn,
    checkOut,
    pricePerNight,
    weekendPrice,
    weekendMode,
    holidayPrice,
    multiNightPrice,
    multiNightWeekendPrice,
    specialDays,
    serviceFeePercent,
    depositPercent,
  } = input;

  const rates = {
    pricePerNight,
    weekendPrice,
    holidayPrice,
    multiNightPrice,
    multiNightWeekendPrice,
    weekendMode,
  };
  const nights = input.dayUse ? [] : nightsInRange(checkIn, checkOut);

  // ─── Day use: one day, no nights ─────────────────────────────────────────
  //
  // Branched here rather than folded into the loop below, because the loop is
  // built on `nightsInRange`, which returns [] when check-in and check-out are
  // the same day — correctly, since a same-day stay has no nights. Running a
  // day-use booking through it unchanged would produce an empty breakdown, a
  // subtotal of 0 and a free booking. That is the single most expensive way
  // this feature could have gone wrong, and it is why `dayUse` is an explicit
  // input rather than something inferred from the dates.
  //
  // A rate of 0 means the listing does not offer day use at all. This still
  // returns the quote — the caller decides what to do about it — but
  // `createBookingRequest` refuses such a request outright rather than writing
  // a booking worth nothing. See the guard there.
  const breakdown: Quote["breakdown"] = input.dayUse
    ? [
        {
          date: checkIn,
          weekend: isWeekend(checkIn, weekendMode),
          amount: dayUseRate(
            {
              dayUsePrice: input.dayUsePrice,
              dayUseWeekendPrice: input.dayUseWeekendPrice,
              weekendMode,
            },
            checkIn,
          ),
        },
      ]
    : nights.map((date) => ({
        date,
        ...nightRate(rates, date, specialDays, nights.length),
      }));

  const subtotal = breakdown.reduce((sum, n) => sum + n.amount, 0);

  // Measured against the same nights priced one at a time, so the figure is
  // exactly what the rate saved — a weekend night with no long-stay rate of its
  // own contributes nothing, because it was not discounted.
  const multiNightSavings = breakdown.reduce(
    (sum, n) =>
      n.multiNight
        ? sum + nightRate(rates, n.date, specialDays).amount - n.amount
        : sum,
    0,
  );
  const serviceFee = Math.round((subtotal * serviceFeePercent) / 100);
  const total = subtotal + serviceFee;

  // The deposit is a share of the **total** — what the guest actually owes,
  // service fee included — not of the subtotal. Computing it from the grand
  // total is what keeps it consistent when the fee changes, and it is the
  // figure quoted right next to the total on screen.
  //
  // `Math.round` matches the service-fee rounding two lines up, so both figures
  // round the same way and a receipt never shows a deposit a dirham off from
  // the same percentage of the printed total.
  const safePercent = clampPercent(depositPercent);
  const depositDue = Math.round((total * safePercent) / 100);

  return {
    // 0 for a day-use stay, and that is the honest figure — the guest is not
    // staying a night. Every consumer reads `dayUse` rather than testing this
    // against 0 to decide what to render.
    nights: input.dayUse ? 0 : breakdown.length,
    subtotal,
    serviceFee,
    total,
    depositDue,
    depositPercent: safePercent,
    dayUse: Boolean(input.dayUse),
    multiNightSavings,
    breakdown,
  };
}

/**
 * The platform's commission on a booking.
 *
 * ─── Not the same thing as the service fee, and the difference is who pays ───
 * `serviceFee` is added ON TOP of the nights and charged to the GUEST. It is
 * now 0 — the total is the advertised price. `commissionDue` is taken OUT of
 * what the owner collected and paid BY THE OWNER, by bank transfer, at step 6
 * of the handover workflow. It is never added to `total` and the guest never
 * sees it, because they already paid it inside the nightly rate.
 *
 * Collapsing the two into one column was the tempting move when the service
 * fee went to zero. It would have meant either billing the guest twice or
 * losing the platform's revenue entirely the moment the fee was switched off.
 *
 * Computed on the total rather than the subtotal so that an operator who later
 * switches a guest-facing service fee back on does not accidentally exempt it
 * from commission.
 */
/**
 * Which commission rate applies to a booking — this owner's, or the platform's.
 *
 * Exactly the shape of `resolveDepositPercent` above, and for the same reason:
 * `OwnerProfile.commissionPercent` is nullable and null and 0 are different
 * claims.
 *   null → "no negotiated rate; charge the platform's"
 *   0    → "this owner pays no commission"
 * `owner.commissionPercent || settings.commissionPercent` collapses them and
 * starts billing an owner who was promised nothing. Hence the explicit test.
 *
 * A platform-owned listing has no owner at all, which resolves to the platform
 * rate — the commission is then owed to nobody by nobody, and the figure is
 * only ever displayed.
 */
export function resolveCommissionPercent(
  ownerCommissionPercent: number | null | undefined,
  platformDefault: number,
): number {
  const raw =
    ownerCommissionPercent === null || ownerCommissionPercent === undefined
      ? platformDefault
      : ownerCommissionPercent;

  if (!Number.isFinite(raw)) return clampPercent(platformDefault);
  return clampPercent(raw);
}

export function platformCommission(
  total: number,
  commissionPercent: number,
): { percent: number; due: number } {
  const percent = clampPercent(commissionPercent);
  return {
    percent,
    // Same rounding as the service fee above, so two figures derived from the
    // same total never land a dirham apart on the same receipt.
    due: Math.round((Math.max(0, total) * percent) / 100),
  };
}

/** The "from" price shown on cards — the weekday rate. */
export function displayPrice(listing: { pricePerNight: number }): number {
  return listing.pricePerNight;
}
