import { isWeekend, nightsInRange, type ISODate } from "./dates";
import { DEPOSIT_PERCENT_MAX, DEPOSIT_PERCENT_MIN } from "./constants";

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

export type QuoteInput = {
  checkIn: ISODate;
  checkOut: ISODate;
  pricePerNight: number;
  /** Friday/Saturday rate. 0 or missing → same as pricePerNight. */
  weekendPrice?: number | null;
  serviceFeePercent: number;
  /** Already resolved through `resolveDepositPercent` — 0..100. */
  depositPercent: number;
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
  /** Per-night breakdown, so a weekend uplift can be shown if we ever want to. */
  breakdown: { date: ISODate; amount: number; weekend: boolean }[];
};

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
    serviceFeePercent,
    depositPercent,
  } = input;

  const weekendRate = weekendPrice && weekendPrice > 0 ? weekendPrice : pricePerNight;

  const breakdown = nightsInRange(checkIn, checkOut).map((date) => {
    const weekend = isWeekend(date);
    return { date, weekend, amount: weekend ? weekendRate : pricePerNight };
  });

  const subtotal = breakdown.reduce((sum, n) => sum + n.amount, 0);
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
    nights: breakdown.length,
    subtotal,
    serviceFee,
    total,
    depositDue,
    depositPercent: safePercent,
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
