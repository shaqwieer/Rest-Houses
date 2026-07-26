import { isWeekend, nightsInRange, type ISODate } from "./dates";

/**
 * Quote calculation — the single place a total is computed.
 *
 * Both the listing sidebar and the booking form call this, so the number the
 * guest sees on the detail page is by construction the number saved with the
 * request and quoted in the WhatsApp message. Amounts are whole dirhams.
 */

export type QuoteInput = {
  checkIn: ISODate;
  checkOut: ISODate;
  pricePerNight: number;
  /** Friday/Saturday rate. 0 or missing → same as pricePerNight. */
  weekendPrice?: number | null;
  serviceFeePercent: number;
  depositPercent: number;
};

export type Quote = {
  nights: number;
  subtotal: number;
  serviceFee: number;
  total: number;
  /** Deposit the owner will ask for on confirmation (display only for now). */
  depositDue: number;
  /** Per-night breakdown, so a weekend uplift can be shown if we ever want to. */
  breakdown: { date: ISODate; amount: number; weekend: boolean }[];
};

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
  const depositDue = Math.round((total * depositPercent) / 100);

  return { nights: breakdown.length, subtotal, serviceFee, total, depositDue, breakdown };
}

/** The "from" price shown on cards — the weekday rate. */
export function displayPrice(listing: { pricePerNight: number }): number {
  return listing.pricePerNight;
}
