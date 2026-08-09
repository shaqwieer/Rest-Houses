import { prisma } from "./prisma";
import {
  addDays,
  DEFAULT_WEEKEND_MODE,
  isWeekend,
  nightsBetween,
  nightsInRange,
  toGulfISODate,
  todayISO,
  toWeekendMode,
} from "./dates";
import { normalizeWhatsapp } from "./whatsapp";

/**
 * Everything the owner dashboard knows about how a rest house is performing.
 *
 * ─── What can and cannot be measured here ────────────────────────────────────
 * There is no analytics in this schema — no page views, no impressions, no
 * search appearances. So there is no funnel from "seen" to "booked", and this
 * module does not invent one. Every figure below is derived from four tables the
 * platform actually writes: BookingRequest, Availability, Review and Listing.
 *
 * That constrains the honest questions to: how much demand arrived, how much of
 * it was converted, how full the calendar is, and what the demand looked like
 * (when, how long, how many). Those turn out to be the questions an owner
 * actually asks.
 *
 * ─── Definitions, fixed here so every screen agrees ──────────────────────────
 * • **Earnings** are `subtotal`, never `total`. `total` includes the platform's
 *   service fee, which is not the owner's money; `securityDeposit` is refundable
 *   and is not income at all. A dashboard that overstates what an owner earns is
 *   worse than one that shows nothing.
 * • **A month** is the month a stay *starts* in (`checkIn`), not the month the
 *   request arrived. An owner thinks in seasons — "how did Ramadan go" — not in
 *   when the message was sent.
 * • **Occupancy** is booked nights ÷ (published listings × days in the window).
 *   Numerator and denominator are scoped identically: an unpublished listing is
 *   not being offered, so it belongs in neither. Counting its nights in the
 *   numerator while excluding it from the denominator is how an occupancy figure
 *   quietly exceeds 100%.
 * • **Confirmation rate** counts only requests that have been *answered*
 *   (confirmed ÷ confirmed + rejected + cancelled). Including requests still
 *   sitting in the inbox would make a fast-growing owner look indecisive.
 *
 * ─── Why this reads rows instead of running aggregates ───────────────────────
 * One owner has a handful of listings and, on this platform, hundreds of
 * requests rather than millions. Fetching the window once and computing in
 * TypeScript keeps every definition above visible in one file, next to the
 * comment explaining it — where fifteen `groupBy` calls would scatter them
 * across fifteen query shapes and give the date-string handling nowhere to live.
 * The read is capped (see `REQUEST_CAP`) so it cannot degrade without notice.
 */

/** How far back the trend and the demand patterns look. */
const WINDOW_DAYS = 180;

/** The near-term window for occupancy and the earnings headline. */
const AHEAD_DAYS = 30;

/** Months shown in the trend, including the current one. */
const TREND_MONTHS = 6;

/**
 * Ceiling on rows read in one dashboard load. Well above what any owner on this
 * platform has; here so that a runaway does not turn the overview into a slow
 * page silently. If an owner ever hits it, the trend is the thing that degrades
 * (it loses the oldest months), which is the least valuable part.
 */
const REQUEST_CAP = 3_000;

const ANSWERED = new Set(["CONFIRMED", "REJECTED", "CANCELLED"]);

export type MonthPoint = {
  /** "2026-07" */
  key: string;
  year: number;
  /** 0-indexed, ready for `arMonthLabel`. */
  month: number;
  requests: number;
  confirmed: number;
  nights: number;
  earnings: number;
};

export type ListingPerformance = {
  id: string;
  name: string;
  nameEn: string | null;
  published: boolean;
  imageCount: number;
  rating: number;
  reviewsCount: number;
  pricePerNight: number;
  weekendPrice: number;
  /** Requests received in the window, all statuses. */
  requests: number;
  confirmed: number;
  earnings: number;
  /** Occupancy over the next AHEAD_DAYS, as a whole percentage. */
  occupancyPct: number;
  /** Nights booked over the next AHEAD_DAYS. */
  bookedNights: number;
  /** ISO date of the most recent request, or null if there has never been one. */
  lastRequestAt: string | null;
};

export type UpcomingStay = {
  id: string;
  reference: string;
  listingName: string;
  customerName: string;
  customerPhone: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  earnings: number;
};

/**
 * A piece of advice the numbers support.
 *
 * `tone` drives the colour and `key` selects the wording — the copy itself lives
 * in the dictionary, because this module has no business knowing which language
 * the owner reads.
 */
export type InsightTone = "urgent" | "opportunity" | "good";

export type Insight = {
  key:
    | "unanswered"
    | "lowConfirmation"
    | "weekendDemand"
    | "quietListing"
    | "fewPhotos"
    | "highOccupancy"
    | "noListings";
  tone: InsightTone;
  /** Already-formatted subject, e.g. a listing name or a count. */
  value?: string;
  count?: number;
};

export type OwnerInsights = {
  /** Headline counters. */
  newRequests: number;
  /** NEW requests that have been waiting more than a day. */
  unanswered: number;
  confirmedAhead: number;
  earningsAhead: number;
  occupancyPct: number;
  bookedNightsAhead: number;
  capacityNightsAhead: number;

  listingCount: number;
  publishedCount: number;

  /** Window totals (WINDOW_DAYS back, by stay month). */
  requestsInWindow: number;
  confirmedInWindow: number;
  earningsInWindow: number;
  confirmationRate: number | null;

  /** Demand shape. null where there is not a single confirmed booking yet. */
  avgBookingValue: number | null;
  avgNights: number | null;
  avgLeadTimeDays: number | null;
  avgGuests: number | null;
  weekendSharePct: number | null;
  repeatGuests: number;

  trend: MonthPoint[];
  listings: ListingPerformance[];
  upcoming: UpcomingStay[];
  insights: Insight[];
};

/** "2026-07-25" → "2026-07". Dates are stored as strings; keep them that way. */
function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** The last `count` months ending with the one `today` falls in. */
function monthBuckets(today: string, count: number): MonthPoint[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1; // 0-indexed
  const out: MonthPoint[] = [];

  for (let back = count - 1; back >= 0; back--) {
    const d = new Date(Date.UTC(year, month - back, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    out.push({
      key: `${y}-${String(m + 1).padStart(2, "0")}`,
      year: y,
      month: m,
      requests: 0,
      confirmed: 0,
      nights: 0,
      earnings: 0,
    });
  }
  return out;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export async function getOwnerInsights(ownerId: string): Promise<OwnerInsights> {
  const today = todayISO();
  const windowStart = addDays(today, -WINDOW_DAYS);
  const horizon = addDays(today, AHEAD_DAYS);
  const trendStart = monthBuckets(today, TREND_MONTHS)[0].key;

  const [listings, requests, bookedDays] = await Promise.all([
    prisma.listing.findMany({
      where: { ownerId },
      select: {
        id: true,
        name: true,
        nameEn: true,
        published: true,
        rating: true,
        reviewsCount: true,
        pricePerNight: true,
        weekendPrice: true,
        // Needed to count weekend nights per listing below — an owner with one
        // rest house in Sharjah and one in Dubai has two different weekends,
        // and a single national constant would misreport both.
        weekendMode: true,
        createdAt: true,
        _count: { select: { images: true } },
      },
      orderBy: { createdAt: "asc" },
    }),

    // Everything the window needs, in one read: the trend, the demand patterns,
    // the per-listing table and the upcoming stays all slice this same list.
    // `checkIn` is a "YYYY-MM-DD" string, so a string comparison IS a date
    // comparison — see the note on Availability in prisma/schema.prisma.
    prisma.bookingRequest.findMany({
      where: {
        listing: { ownerId },
        OR: [{ checkIn: { gte: windowStart } }, { status: "NEW" }],
      },
      select: {
        id: true,
        reference: true,
        status: true,
        checkIn: true,
        checkOut: true,
        nights: true,
        guests: true,
        subtotal: true,
        customerName: true,
        customerPhone: true,
        createdAt: true,
        listingId: true,
        listing: { select: { name: true } },
      },
      // Newest first, so if the cap is ever reached it is the *oldest* stays
      // that fall off — the tail of the trend — rather than the upcoming ones
      // every headline figure on the page depends on. Sorted back into calendar
      // order below, which is the order the rest of this function reads in.
      orderBy: { checkIn: "desc" },
      take: REQUEST_CAP,
    }),

    // Availability is the calendar's own truth — an owner can also block days by
    // hand, and a confirmed booking writes its nights here. Counting nights from
    // this table rather than from booking rows means the occupancy figure matches
    // what the calendar shows.
    //
    // EXTERNAL is included with BOOKED: a night sold on Airbnb or Booking.com is
    // a night this rest house is full, and an owner who takes half their
    // business there would otherwise see their own dashboard call them empty.
    // Owner blocks are still excluded — a day closed for maintenance is not
    // demand and counting it would flatter the figure.
    //
    // `distinct` on (listingId, date) rather than counting rows: since imported
    // calendars arrived a row is a *reason* a day is closed, not the day, and a
    // night both booked here and present in a feed is two rows for one night.
    // Counting rows would let occupancy exceed 100%.
    prisma.availability.findMany({
      where: {
        status: { in: ["BOOKED", "EXTERNAL"] },
        date: { gte: today, lt: horizon },
        listing: { ownerId, published: true },
      },
      select: { listingId: true, date: true },
      distinct: ["listingId", "date"],
    }),
  ]);

  // Back into calendar order — see the note on the query's `orderBy`.
  requests.sort((a, b) => (a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0));

  const publishedListings = listings.filter((l) => l.published);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  /* ---- headline counters ------------------------------------------------- */

  const newRequests = requests.filter((r) => r.status === "NEW").length;
  const unanswered = requests.filter(
    (r) => r.status === "NEW" && r.createdAt < dayAgo,
  ).length;

  const confirmedAheadRows = requests.filter(
    (r) => r.status === "CONFIRMED" && r.checkIn >= today && r.checkIn < horizon,
  );
  const confirmedAhead = confirmedAheadRows.length;
  const earningsAhead = confirmedAheadRows.reduce((sum, r) => sum + r.subtotal, 0);

  const bookedNightsAhead = bookedDays.length;
  const capacityNightsAhead = publishedListings.length * AHEAD_DAYS;
  const occupancyPct =
    capacityNightsAhead > 0 ? Math.round((bookedNightsAhead / capacityNightsAhead) * 100) : 0;

  /* ---- the window --------------------------------------------------------- */

  const inWindow = requests.filter((r) => r.checkIn >= windowStart);
  const confirmedInWindowRows = inWindow.filter((r) => r.status === "CONFIRMED");
  const answered = inWindow.filter((r) => ANSWERED.has(r.status));

  const confirmationRate =
    answered.length > 0
      ? Math.round((confirmedInWindowRows.length / answered.length) * 100)
      : null;

  /* ---- demand shape ------------------------------------------------------- */

  const avgBookingValue = mean(confirmedInWindowRows.map((r) => r.subtotal));
  const avgNights = mean(confirmedInWindowRows.map((r) => r.nights));
  const avgGuests = mean(confirmedInWindowRows.map((r) => r.guests));

  // Lead time mixes a real timestamp with a calendar string, so the timestamp is
  // reduced to a calendar day first — `nightsBetween` on two date-only strings
  // has no timezone left to get wrong. Negative values (a request logged after
  // the stay began) are clamped rather than dropped, so the mean stays honest.
  //
  // It has to be reduced in GULF time, not UTC. `checkIn` is a calendar day
  // chosen on a Gulf calendar, and `toISODate` flips at UTC midnight — four
  // hours after the day it is being compared against has already turned over.
  // Between 20:00 and 24:00 UTC the two disagreed and every lead time came out
  // a day too long.
  const avgLeadTimeDays = mean(
    confirmedInWindowRows.map((r) =>
      Math.max(0, nightsBetween(toGulfISODate(r.createdAt), r.checkIn)),
    ),
  );

  // Each booking's nights are judged against ITS OWN listing's weekend, not one
  // shared answer: this owner may run a Sharjah rest house whose weekend is
  // three days long alongside a Dubai one whose weekend is two. A booking whose
  // listing has since been deleted falls back to the platform default rather
  // than being dropped — the night still happened.
  const weekendByListing = new Map(listings.map((l) => [l.id, toWeekendMode(l.weekendMode)]));

  let weekendNights = 0;
  let totalNights = 0;
  for (const r of confirmedInWindowRows) {
    const mode = weekendByListing.get(r.listingId) ?? DEFAULT_WEEKEND_MODE;
    for (const night of nightsInRange(r.checkIn, r.checkOut)) {
      totalNights += 1;
      if (isWeekend(night, mode)) weekendNights += 1;
    }
  }
  const weekendSharePct = totalNights > 0 ? Math.round((weekendNights / totalNights) * 100) : null;

  // A guest who came back. Counted on the phone number, which is the one field
  // every request has and the one a returning guest reliably repeats.
  //
  // Compared through `normalizeWhatsapp` rather than by stripping punctuation: a
  // guest who wrote "+971 50 111 1111" in March and "0501111111" in June is one
  // guest, and only the normaliser knows that the leading 0 and the country code
  // are the same thing. Stripping digits alone would report them as two.
  const phoneCounts = new Map<string, number>();
  for (const r of confirmedInWindowRows) {
    const key = normalizeWhatsapp(r.customerPhone);
    if (key) phoneCounts.set(key, (phoneCounts.get(key) ?? 0) + 1);
  }
  const repeatGuests = [...phoneCounts.values()].filter((n) => n > 1).length;

  /* ---- monthly trend ------------------------------------------------------ */

  const trend = monthBuckets(today, TREND_MONTHS);
  const byMonth = new Map(trend.map((point) => [point.key, point]));

  for (const r of requests) {
    if (r.checkIn < trendStart) continue;
    const point = byMonth.get(monthKey(r.checkIn));
    if (!point) continue; // a stay beyond the current month — not in the trend
    point.requests += 1;
    if (r.status === "CONFIRMED") {
      point.confirmed += 1;
      point.nights += r.nights;
      point.earnings += r.subtotal;
    }
  }

  /* ---- per listing -------------------------------------------------------- */

  const nightsByListing = new Map<string, number>();
  for (const day of bookedDays) {
    nightsByListing.set(day.listingId, (nightsByListing.get(day.listingId) ?? 0) + 1);
  }

  const listingRows: ListingPerformance[] = listings.map((l) => {
    const mine = inWindow.filter((r) => r.listingId === l.id);
    const confirmed = mine.filter((r) => r.status === "CONFIRMED");
    const booked = nightsByListing.get(l.id) ?? 0;
    const lastRequest = mine.reduce<Date | null>(
      (latest, r) => (latest === null || r.createdAt > latest ? r.createdAt : latest),
      null,
    );

    return {
      id: l.id,
      name: l.name,
      nameEn: l.nameEn,
      published: l.published,
      imageCount: l._count.images,
      rating: l.rating,
      reviewsCount: l.reviewsCount,
      pricePerNight: l.pricePerNight,
      weekendPrice: l.weekendPrice,
      requests: mine.length,
      confirmed: confirmed.length,
      earnings: confirmed.reduce((sum, r) => sum + r.subtotal, 0),
      // Per listing the denominator is the window itself — one listing can only
      // be occupied for as many nights as there are.
      occupancyPct: Math.round((booked / AHEAD_DAYS) * 100),
      bookedNights: booked,
      // A moment, not a stored day — the Gulf calendar day the request came in
      // on. `toISODate` would date a 01:00 Dubai request to the day before.
      lastRequestAt: lastRequest ? toGulfISODate(lastRequest) : null,
    };
  });

  listingRows.sort((a, b) => b.earnings - a.earnings || b.requests - a.requests);

  /* ---- upcoming stays ----------------------------------------------------- */

  const twoWeeks = addDays(today, 14);
  const upcoming: UpcomingStay[] = requests
    .filter((r) => r.status === "CONFIRMED" && r.checkIn >= today && r.checkIn <= twoWeeks)
    .slice(0, 8)
    .map((r) => ({
      id: r.id,
      reference: r.reference,
      listingName: r.listing.name,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      nights: r.nights,
      guests: r.guests,
      earnings: r.subtotal,
    }));

  /* ---- advice ------------------------------------------------------------- */
  //
  // Only things the numbers actually support, and only when they are actionable.
  // An advice strip that always has something to say is one an owner stops
  // reading, so each of these has a threshold and stays silent below it.

  const insights: Insight[] = [];

  if (listings.length === 0) {
    insights.push({ key: "noListings", tone: "opportunity" });
  }

  if (unanswered > 0) {
    insights.push({ key: "unanswered", tone: "urgent", count: unanswered });
  }

  if (confirmationRate !== null && answered.length >= 5 && confirmationRate < 50) {
    insights.push({ key: "lowConfirmation", tone: "urgent", count: confirmationRate });
  }

  // Weekend demand is only worth raising if the owner is leaving money on the
  // table — that is, a listing that charges the same on Friday as on Monday.
  const flatWeekendPricing = publishedListings.find(
    (l) => l.weekendPrice === 0 || l.weekendPrice <= l.pricePerNight,
  );
  if (weekendSharePct !== null && weekendSharePct >= 55 && totalNights >= 8 && flatWeekendPricing) {
    insights.push({ key: "weekendDemand", tone: "opportunity", count: weekendSharePct });
  }

  // "No requests" only means something once a listing has been up long enough to
  // have had the chance. Telling an owner to rework the photos on a rest house
  // they published yesterday is noise, and it arrives alongside the
  // "add more photos" card, so they would get scolded twice for being new.
  const settledAge = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const listingAge = new Map(listings.map((l) => [l.id, l.createdAt]));
  const quiet = listingRows.find(
    (l) => l.published && l.requests === 0 && (listingAge.get(l.id) ?? new Date()) < settledAge,
  );
  if (quiet) {
    insights.push({ key: "quietListing", tone: "opportunity", value: quiet.name });
  }

  const thin = listingRows.find((l) => l.published && l.imageCount < 4);
  if (thin) {
    insights.push({ key: "fewPhotos", tone: "opportunity", value: thin.name });
  }

  if (occupancyPct >= 70 && publishedListings.length > 0) {
    insights.push({ key: "highOccupancy", tone: "good", count: occupancyPct });
  }

  return {
    newRequests,
    unanswered,
    confirmedAhead,
    earningsAhead,
    occupancyPct,
    bookedNightsAhead,
    capacityNightsAhead,

    listingCount: listings.length,
    publishedCount: publishedListings.length,

    requestsInWindow: inWindow.length,
    confirmedInWindow: confirmedInWindowRows.length,
    earningsInWindow: confirmedInWindowRows.reduce((sum, r) => sum + r.subtotal, 0),
    confirmationRate,

    avgBookingValue: avgBookingValue === null ? null : Math.round(avgBookingValue),
    avgNights: avgNights === null ? null : Math.round(avgNights * 10) / 10,
    avgLeadTimeDays: avgLeadTimeDays === null ? null : Math.round(avgLeadTimeDays),
    avgGuests: avgGuests === null ? null : Math.round(avgGuests),
    weekendSharePct,
    repeatGuests,

    trend,
    listings: listingRows,
    upcoming,
    insights: insights.slice(0, 3),
  };
}

export const OWNER_INSIGHT_WINDOW_DAYS = WINDOW_DAYS;
export const OWNER_INSIGHT_AHEAD_DAYS = AHEAD_DAYS;
