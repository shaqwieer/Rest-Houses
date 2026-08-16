import { prisma } from "./prisma";
import {
  addDays,
  dayOfWeek,
  DEFAULT_WEEKEND_MODE,
  isISODate,
  isWeekend,
  occupiedDays,
  toWeekendMode,
  todayISO,
  weekendDays,
  type ISODate,
  type WeekendMode,
} from "./dates";
import {
  BOOKING_SOURCES,
  isCalendarPlatform,
  toBookingSource,
  type BookingSource,
  type CalendarPlatform,
} from "./constants";

/**
 * Performance analytics — the one module behind the owner's dashboard and the
 * operator's per-rest-house view.
 *
 * ─── One implementation, two audiences ───────────────────────────────────────
 * The operator asked for "the same indicators as the owner sees, with a picker
 * for which rest house". Written twice, the two would drift within a release
 * and an owner would be shown one occupancy figure while the operator on the
 * phone to them read another. So the scope is a parameter and the arithmetic is
 * written once.
 *
 * ─── Scoping is composition, and that is what makes it safe ──────────────────
 * `ownerId` and `listingId` are ANDed, never swapped. An owner's page always
 * passes its own `ownerId`; if a `?listing=` parameter arrives pointing at
 * somebody else's rest house, the two conditions together match nothing and the
 * page renders zeroes. There is no code path in which supplying a listing id
 * widens what you can see — which is the property the CSV export route needs,
 * since a query string is the easiest thing in the world to edit.
 *
 * ─── Definitions, fixed here so every panel agrees ───────────────────────────
 * • **Revenue** is `subtotal`. `total` includes the platform's service fee,
 *   which is not the owner's money, and `securityDeposit` is refundable and not
 *   income at all. **Net** is `subtotal - commissionDue`: what is left after the
 *   platform's cut. Both are stated per booking and snapshotted at request time,
 *   so a later change to either rate cannot rewrite history.
 * • **A booking belongs to the period its stay STARTS in** (`checkIn`) — the
 *   same convention `owner-insights.ts` documents. Every revenue figure on
 *   every panel therefore sums to the same total.
 * • **Occupancy is a calendar measure**, read from `Availability` rather than
 *   from booking rows, so it matches what the calendar page shows. Its window
 *   is the period's dates. A booking straddling the edge of the period can
 *   therefore contribute days to occupancy without contributing revenue, and
 *   vice versa. That is not a discrepancy; they are answers to two different
 *   questions and the panels say which is which.
 * • **Days, not nights.** Every per-day figure divides by
 *   `occupiedDays(...).length`, never by `nights`. A day-use booking
 *   (حجز بدون مبيت) stores `nights = 0` — see the note on `BookingRequest` in
 *   prisma/schema.prisma — so dividing by nights makes the average daily rate
 *   `Infinity` on exactly the bookings §6 exists to compare.
 * • **Cancellation rate** is cancelled ÷ (confirmed + cancelled). A REJECTED
 *   request is an owner declining an enquiry, which is not a booking falling
 *   through, and folding the two together would make a selective owner look
 *   unreliable.
 */

/* -------------------------------------------------------------------------- */
/* The period                                                                 */
/* -------------------------------------------------------------------------- */

export const ANALYTICS_PERIODS = ["7d", "30d", "3m", "6m", "1y", "custom"] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const DEFAULT_PERIOD: AnalyticsPeriod = "30d";

/**
 * Exact day counts rather than calendar months, because the comparison against
 * "the previous period" is only honest between two windows of the same length.
 * "3 months" measured as 90 days against the 90 before it compares like with
 * like; measured as calendar months it would compare a 92-day quarter with an
 * 89-day one and call the difference growth.
 */
const PERIOD_DAYS: Record<Exclude<AnalyticsPeriod, "custom">, number> = {
  "7d": 7,
  "30d": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
};

/** Ceiling on a custom range, so a hand-typed URL cannot ask for a decade. */
export const MAX_CUSTOM_DAYS = 731;

export function isAnalyticsPeriod(v: unknown): v is AnalyticsPeriod {
  return typeof v === "string" && (ANALYTICS_PERIODS as readonly string[]).includes(v);
}

/** A half-open span of calendar days: `from` inclusive, `to` exclusive. */
export type DateRange = {
  from: ISODate;
  /** Exclusive — the day AFTER the last one in the range. */
  to: ISODate;
  days: number;
  /** The last day actually inside the range, for display. */
  lastDay: ISODate;
};

export type ResolvedPeriod = {
  period: AnalyticsPeriod;
  range: DateRange;
  /** The equally long span immediately before `range`, for the deltas. */
  previous: DateRange;
};

function rangeOf(from: ISODate, to: ISODate): DateRange {
  const days = Math.max(
    1,
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
    ),
  );
  return { from, to, days, lastDay: addDays(to, -1) };
}

/**
 * Turn the query string into a period.
 *
 * Every branch is clamped rather than rejected: a mistyped date in a URL should
 * show the default thirty days, not an error page. `to` arrives as the last day
 * the reader means to include and is pushed one day forward here, so the range
 * is half-open like every other date query in this codebase and the final day
 * is not silently dropped.
 */
export function resolvePeriod(
  params: { period?: string; from?: string; to?: string },
  today: ISODate = todayISO(),
): ResolvedPeriod {
  const period = isAnalyticsPeriod(params.period) ? params.period : DEFAULT_PERIOD;

  if (period === "custom") {
    const from = params.from;
    const to = params.to;
    if (isISODate(from) && isISODate(to) && from <= to) {
      const exclusiveEnd = addDays(to, 1);
      const span = rangeOf(from, exclusiveEnd);
      if (span.days <= MAX_CUSTOM_DAYS) {
        return { period, range: span, previous: precedingRange(span) };
      }
      // Too wide: keep the end the reader asked for and pull the start in.
      const capped = rangeOf(addDays(exclusiveEnd, -MAX_CUSTOM_DAYS), exclusiveEnd);
      return { period, range: capped, previous: precedingRange(capped) };
    }
    // A custom period with no usable dates behaves as the default rather than
    // rendering an empty page the reader cannot explain.
    return resolvePeriod({ period: DEFAULT_PERIOD }, today);
  }

  // Ends today, inclusive — an owner asking "how did the last 30 days go"
  // means the thirty days up to and including this one.
  const to = addDays(today, 1);
  const range = rangeOf(addDays(to, -PERIOD_DAYS[period]), to);
  return { period, range, previous: precedingRange(range) };
}

function precedingRange(range: DateRange): DateRange {
  return rangeOf(addDays(range.from, -range.days), range.from);
}

/* -------------------------------------------------------------------------- */
/* Scope                                                                      */
/* -------------------------------------------------------------------------- */

export type AnalyticsScope = {
  /** Restricts to one owner's rest houses. Omitted for the operator. */
  ownerId?: string;
  /** Restricts to a single rest house. ANDed with `ownerId` — see the header. */
  listingId?: string;
};

/**
 * Ceiling on availability rows read for one view.
 *
 * A row is two short columns and the realistic worst case — every rest house on
 * the platform, over a year — is well inside this. It is here so a runaway
 * cannot turn the page into a timeout silently; when it bites, `truncated` says
 * so on screen rather than quietly under-reporting occupancy.
 */
const AVAILABILITY_CAP = 120_000;

/** Same idea for the booking read. */
const BOOKING_CAP = 20_000;

/* -------------------------------------------------------------------------- */
/* Result shape                                                               */
/* -------------------------------------------------------------------------- */

export type Kpis = {
  /** Σ subtotal — the owner's billing for the stay. */
  revenue: number;
  /** Σ (subtotal − commissionDue) — after the platform's cut. */
  netRevenue: number;
  bookings: number;
  occupancyPct: number;
  /** Revenue ÷ bookings, or null with no bookings at all. */
  avgBookingValue: number | null;
  /** Revenue ÷ days those bookings occupy — the average daily rate. */
  avgDailyRate: number | null;
  bookedDays: number;
  availableDays: number;
  /** Cancelled ÷ (confirmed + cancelled). Null until there is one of either. */
  cancellationPct: number | null;
};

export type TimePoint = {
  /** The first day of the bucket, for the key and the tooltip. */
  key: ISODate;
  label: string;
  /**
   * How many calendar days this bucket actually covers.
   *
   * Usually the full width of the bucket, but a range rarely divides into whole
   * weeks or months, so one bucket at the oldest end is short. The chart reads
   * this to say the bucket's real span rather than letting a two-day bar be
   * compared with a seven-day one in silence.
   */
  days: number;
  revenue: number;
  bookings: number;
  occupancyPct: number;
};

export type DayOfWeekPoint = {
  /** 0 = Sunday … 6 = Saturday, matching `dayNames()`. */
  day: number;
  occupancyPct: number;
  revenue: number;
  bookedDays: number;
  capacityDays: number;
};

export type StayTypeSplit = {
  bookings: number;
  revenue: number;
  avgValue: number | null;
};

export type SourceRow = {
  key: BookingSource;
  bookings: number;
  revenue: number;
  /** Days those bookings occupy inside the period. */
  days: number;
  /**
   * Days an imported calendar closed with no recorded booking behind them —
   * the part of this channel whose money is still unknown. Always 0 for the
   * two channels that have no feed (this platform, and a direct booking).
   */
  unrecordedDays: number;
};

export type PricingBreakdown = {
  /** Realised price per occupied weekday / weekend day. */
  weekdayRate: number | null;
  weekendRate: number | null;
  weekdayOccupancyPct: number;
  weekendOccupancyPct: number;
  /** What a booking actually went for, on average. */
  avgBookingValue: number | null;
};

export type ListingRow = {
  id: string;
  name: string;
  nameEn: string | null;
  published: boolean;
  bookings: number;
  revenue: number;
  occupancyPct: number;
  bookedDays: number;
};

export type AnalyticsAlert = {
  key:
    | "bestDay"
    | "worstDay"
    | "raisePrice"
    | "emptyDays"
    | "potentialRevenue"
    | "noData";
  tone: "good" | "opportunity" | "urgent";
  /** Pre-resolved numbers; the wording lives in the dictionary. */
  day?: number;
  pct?: number;
  count?: number;
  amount?: number;
};

export type Analytics = {
  range: DateRange;
  previous: DateRange;
  kpis: Kpis;
  /** The same measures over `previous`, for the change indicators. */
  priorKpis: Kpis;

  trend: TimePoint[];
  /** "day" | "week" | "month" — what one point on the trend covers. */
  bucket: TrendBucket;

  /** §4 — how the calendar was spent. The three sum to capacity. */
  bookedDays: number;
  blockedDays: number;
  availableDays: number;
  capacityDays: number;
  weekdayOccupancyPct: number;
  weekendOccupancyPct: number;

  byDayOfWeek: DayOfWeekPoint[];
  overnight: StayTypeSplit;
  dayUse: StayTypeSplit;
  sources: SourceRow[];
  pricing: PricingBreakdown;
  listings: ListingRow[];
  alerts: AnalyticsAlert[];

  listingCount: number;
  /** True when a cap was hit and the figures are therefore partial. */
  truncated: boolean;
};

export type TrendBucket = "day" | "week" | "month";

/* -------------------------------------------------------------------------- */

/** A booking, reduced to what every panel below needs. */
type BookingRow = {
  id: string;
  listingId: string;
  status: string;
  /** One of BOOKING_SOURCES; normalised through `toBookingSource` on read. */
  source: string;
  checkIn: ISODate;
  checkOut: ISODate;
  dayUse: boolean;
  subtotal: number;
  commissionDue: number;
};

type AvailabilityRow = {
  listingId: string;
  date: ISODate;
  status: string;
  feedId: string | null;
};

type ScopedListing = {
  id: string;
  name: string;
  nameEn: string | null;
  published: boolean;
  pricePerNight: number;
  weekendPrice: number;
  weekendMode: WeekendMode;
};

/* -------------------------------------------------------------------------- */

export async function getAnalytics(
  scope: AnalyticsScope,
  period: ResolvedPeriod,
): Promise<Analytics> {
  const listingWhere = {
    ...(scope.ownerId ? { ownerId: scope.ownerId } : {}),
    ...(scope.listingId ? { id: scope.listingId } : {}),
  };

  const listingRows = await prisma.listing.findMany({
    where: listingWhere,
    select: {
      id: true,
      name: true,
      nameEn: true,
      published: true,
      pricePerNight: true,
      weekendPrice: true,
      // Per listing, not per platform: an owner may run a Sharjah rest house
      // whose weekend is three days long alongside a Dubai one whose weekend is
      // two, and a single national constant would misreport both.
      weekendMode: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const listings: ScopedListing[] = listingRows.map((l) => ({
    ...l,
    weekendMode: toWeekendMode(l.weekendMode),
  }));
  const ids = listings.map((l) => l.id);

  if (ids.length === 0) return emptyAnalytics(period);

  const [current, prior] = await Promise.all([
    readWindow(ids, period.range),
    // Only the KPI subset is needed from the previous window, but reading it
    // through the same function is what guarantees the two are measured the
    // same way — a delta between two differently-computed numbers is noise.
    readWindow(ids, period.previous),
  ]);

  const feeds = await prisma.calendarFeed.findMany({
    where: { listingId: { in: ids } },
    select: { id: true, platform: true },
  });
  const platformByFeed = new Map(feeds.map((f) => [f.id, f.platform]));

  const weekendByListing = new Map(listings.map((l) => [l.id, l.weekendMode]));

  const calendar = readCalendar(current.availability, listings, period.range, weekendByListing);
  const priorCalendar = readCalendar(
    prior.availability,
    listings,
    period.previous,
    weekendByListing,
  );

  const kpis = computeKpis(current.bookings, calendar);
  const priorKpis = computeKpis(prior.bookings, priorCalendar);

  const confirmed = current.bookings.filter((b) => b.status === "CONFIRMED");

  return {
    range: period.range,
    previous: period.previous,
    kpis,
    priorKpis,

    ...buildTrend(confirmed, current.availability, listings, period.range),

    bookedDays: calendar.bookedDays,
    blockedDays: calendar.blockedDays,
    availableDays: calendar.availableDays,
    capacityDays: calendar.capacityDays,
    weekdayOccupancyPct: calendar.weekdayOccupancyPct,
    weekendOccupancyPct: calendar.weekendOccupancyPct,

    byDayOfWeek: buildDayOfWeek(confirmed, calendar, period.range),
    ...splitByStayType(confirmed),
    sources: buildSources(confirmed, current.availability, platformByFeed, period.range),
    pricing: buildPricing(confirmed, calendar, weekendByListing),
    listings: buildListingRows(confirmed, calendar, listings, period.range),
    alerts: buildAlerts(confirmed, calendar, listings),

    listingCount: listings.length,
    truncated: current.truncated || prior.truncated,
  };
}

/* -------------------------------------------------------------------------- */
/* The two reads                                                              */
/* -------------------------------------------------------------------------- */

async function readWindow(listingIds: string[], range: DateRange) {
  const [bookings, availability] = await Promise.all([
    // Every status, not just CONFIRMED: the cancellation rate needs the ones
    // that fell through, and a second query for them would have to repeat this
    // WHERE clause exactly or quietly measure a different set of bookings.
    prisma.bookingRequest.findMany({
      where: {
        listingId: { in: listingIds },
        checkIn: { gte: range.from, lt: range.to },
      },
      select: {
        id: true,
        listingId: true,
        status: true,
        source: true,
        checkIn: true,
        checkOut: true,
        dayUse: true,
        subtotal: true,
        commissionDue: true,
      },
      take: BOOKING_CAP,
    }),

    // Read raw rather than `distinct`, because the source of each closed day is
    // exactly what §7 reports and `distinct` on (listingId, date) would collapse
    // a day that is both booked here and present in an Airbnb feed into one row
    // of unknown origin. The de-duplication happens in `readCalendar`, where the
    // rule can be written down beside the reason for it.
    prisma.availability.findMany({
      where: {
        listingId: { in: listingIds },
        date: { gte: range.from, lt: range.to },
        status: { in: ["BOOKED", "EXTERNAL", "BLOCKED"] },
      },
      select: { listingId: true, date: true, status: true, feedId: true },
      take: AVAILABILITY_CAP,
    }),
  ]);

  return {
    bookings: bookings as BookingRow[],
    availability: availability as AvailabilityRow[],
    truncated: bookings.length === BOOKING_CAP || availability.length === AVAILABILITY_CAP,
  };
}

/* -------------------------------------------------------------------------- */
/* The calendar                                                               */
/* -------------------------------------------------------------------------- */

type Calendar = {
  /** `${listingId}|${date}` for every day sold. */
  sold: Set<string>;
  /** Days the owner closed, minus any that also sold. */
  closed: Set<string>;
  bookedDays: number;
  blockedDays: number;
  availableDays: number;
  capacityDays: number;
  occupancyPct: number;
  weekdayOccupancyPct: number;
  weekendOccupancyPct: number;
  /** Booked and capacity day counts per weekday, 0 = Sunday. */
  bookedByDow: number[];
  capacityByDow: number[];
  /** Booked days per listing. */
  bookedByListing: Map<string, number>;
};

/**
 * What the calendar did with the period.
 *
 * ─── The two rules, and why the buckets are exclusive ────────────────────────
 *  • A night imported from Airbnb or Booking.com counts as SOLD. It is a night
 *    the rest house cannot be let for, and an owner taking half their business
 *    there would otherwise watch this page call them empty.
 *  • A day that is both sold and blocked is SOLD. Precedence rather than
 *    addition, because the three buckets are reported as a breakdown of
 *    capacity and have to sum to it — counting such a day twice would produce
 *    "available: −3".
 *
 * ─── Capacity ────────────────────────────────────────────────────────────────
 * Every listing in scope, published or not, on both sides of the ratio. Basing
 * the denominator on today's `published` flag would make a historical figure
 * change the moment an owner hid a rest house — and hiding one would push last
 * quarter's occupancy up, which is precisely backwards.
 */
function readCalendar(
  rows: AvailabilityRow[],
  listings: ScopedListing[],
  range: DateRange,
  weekendByListing: Map<string, WeekendMode>,
): Calendar {
  const sold = new Set<string>();
  const blocked = new Set<string>();

  for (const row of rows) {
    const key = `${row.listingId}|${row.date}`;
    if (row.status === "BLOCKED") blocked.add(key);
    else sold.add(key);
  }

  const closed = new Set([...blocked].filter((key) => !sold.has(key)));

  const bookedByDow = new Array(7).fill(0) as number[];
  const capacityByDow = new Array(7).fill(0) as number[];
  const bookedByListing = new Map<string, number>();

  let weekendBooked = 0;
  let weekendCapacity = 0;
  let weekdayBooked = 0;
  let weekdayCapacity = 0;

  // The calendar days of the period, each with its weekday, worked out once.
  // The loop below is listings × days and both `addDays` and `dayOfWeek`
  // allocate a Date, so doing this inside it would build a few hundred thousand
  // of them for a wide operator view.
  const days: { iso: ISODate; dow: number }[] = [];
  for (let day = range.from; day < range.to; day = addDays(day, 1)) {
    days.push({ iso: day, dow: dayOfWeek(day) });
  }

  // Walked day by day rather than derived from counts, because weekend-ness is
  // a property of a (listing, day) pair — see `weekendMode` — and the two
  // occupancy figures below are the whole point of §4 and §8.
  for (const listing of listings) {
    const mode = weekendByListing.get(listing.id) ?? DEFAULT_WEEKEND_MODE;
    // Which weekday numbers this listing charges the weekend rate on, resolved
    // once per listing instead of once per day.
    const weekendDow = new Set(weekendDays(mode));

    for (const { iso, dow } of days) {
      const weekend = weekendDow.has(dow);

      capacityByDow[dow] += 1;
      if (weekend) weekendCapacity += 1;
      else weekdayCapacity += 1;

      if (sold.has(`${listing.id}|${iso}`)) {
        bookedByDow[dow] += 1;
        bookedByListing.set(listing.id, (bookedByListing.get(listing.id) ?? 0) + 1);
        if (weekend) weekendBooked += 1;
        else weekdayBooked += 1;
      }
    }
  }

  const capacityDays = listings.length * range.days;
  const bookedDays = sold.size;
  const blockedDays = closed.size;

  return {
    sold,
    closed,
    bookedDays,
    blockedDays,
    availableDays: Math.max(0, capacityDays - bookedDays - blockedDays),
    capacityDays,
    occupancyPct: pct(bookedDays, capacityDays),
    weekdayOccupancyPct: pct(weekdayBooked, weekdayCapacity),
    weekendOccupancyPct: pct(weekendBooked, weekendCapacity),
    bookedByDow,
    capacityByDow,
    bookedByListing,
  };
}

/* -------------------------------------------------------------------------- */
/* Headline figures                                                           */
/* -------------------------------------------------------------------------- */

function computeKpis(bookings: BookingRow[], calendar: Calendar): Kpis {
  const confirmed = bookings.filter((b) => b.status === "CONFIRMED");
  const cancelled = bookings.filter((b) => b.status === "CANCELLED");

  const revenue = sum(confirmed.map((b) => b.subtotal));
  const netRevenue = sum(confirmed.map((b) => b.subtotal - b.commissionDue));

  // `occupiedDays`, never `nights`: a day-use booking stores `nights = 0`, and
  // dividing by it makes the average daily rate Infinity on exactly the
  // bookings the "with and without an overnight stay" panel exists to compare.
  const soldDays = sum(confirmed.map((b) => stayDays(b).length));

  const answered = confirmed.length + cancelled.length;

  return {
    revenue,
    netRevenue,
    bookings: confirmed.length,
    occupancyPct: calendar.occupancyPct,
    avgBookingValue: confirmed.length > 0 ? Math.round(revenue / confirmed.length) : null,
    avgDailyRate: soldDays > 0 ? Math.round(revenue / soldDays) : null,
    bookedDays: calendar.bookedDays,
    availableDays: calendar.availableDays,
    cancellationPct: answered > 0 ? Math.round((cancelled.length / answered) * 100) : null,
  };
}

/* -------------------------------------------------------------------------- */
/* §3 — the trend                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Bucket width, chosen from the span so a chart never has to draw 365 bars.
 * Daily up to a fortnight, weekly up to a quarter, monthly beyond — which puts
 * between 5 and 14 marks on the plot at every preset the filter offers.
 *
 * The daily threshold is deliberately well short of a month. Thirty daily bars
 * on a phone are thin enough that most of them cannot carry a label or a value,
 * and a rest house with eight bookings in a month reads as twenty-two days of
 * failure rather than as two thousand dirhams a week. The same month in five
 * weekly bars is the same money, legible.
 */
function bucketFor(days: number): TrendBucket {
  if (days <= 14) return "day";
  if (days <= 92) return "week";
  return "month";
}

function buildTrend(
  confirmed: BookingRow[],
  availability: AvailabilityRow[],
  listings: ScopedListing[],
  range: DateRange,
): { trend: TimePoint[]; bucket: TrendBucket } {
  const bucket = bucketFor(range.days);

  // Every bucket in the range, including the empty ones. A chart that omits a
  // month with no bookings shows a gap as continuity and reads as growth.
  const buckets = new Map<ISODate, TimePoint & { capacity: number; booked: number }>();
  const order: ISODate[] = [];

  for (let day = range.from; day < range.to; day = addDays(day, 1)) {
    const key = bucketKey(day, bucket, range);
    let point = buckets.get(key);
    if (!point) {
      point = {
        key,
        label: key,
        days: 0,
        revenue: 0,
        bookings: 0,
        occupancyPct: 0,
        capacity: 0,
        booked: 0,
      };
      buckets.set(key, point);
      order.push(key);
    }
    point.days += 1;
    point.capacity += listings.length;
  }

  // Occupancy per bucket, from the calendar — de-duplicated the same way
  // `readCalendar` does it, since a day present in two feeds is one day.
  const seen = new Set<string>();
  for (const row of availability) {
    if (row.status === "BLOCKED") continue;
    const key = `${row.listingId}|${row.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const point = buckets.get(bucketKey(row.date, bucket, range));
    if (point) point.booked += 1;
  }

  // Revenue and count go in by CHECK-IN, the convention stated at the top —
  // so the bars on this chart sum to the revenue on the headline tile.
  for (const booking of confirmed) {
    const point = buckets.get(bucketKey(booking.checkIn, bucket, range));
    if (!point) continue;
    point.revenue += booking.subtotal;
    point.bookings += 1;
  }

  const trend = order.map((key) => {
    const point = buckets.get(key)!;
    return {
      key,
      label: key,
      days: point.days,
      revenue: point.revenue,
      bookings: point.bookings,
      occupancyPct: pct(point.booked, point.capacity),
    };
  });

  return { trend, bucket };
}

/**
 * Which bucket a day falls in, named by the bucket's first day.
 *
 * Weeks are counted BACK from the last day of the range rather than from a
 * Sunday or from the range's start. Thirty days is four weeks and two days over,
 * and that remainder has to land somewhere: counting forward puts it on the
 * newest bar, so "the last two days" is drawn beside four full weeks and the
 * period ends on what looks like a collapse in demand. Counting back makes every
 * recent bucket a whole week — the ones an owner actually acts on — and leaves
 * the short one at the oldest end, where it is furthest from that reading and
 * where `TimePoint.days` names its real span.
 *
 * Calendar weeks would open AND close the chart with stubs, which is worse than
 * either.
 */
function bucketKey(day: ISODate, bucket: TrendBucket, range: DateRange): ISODate {
  if (bucket === "day") return day;
  if (bucket === "month") return `${day.slice(0, 7)}-01`;
  const fromEnd = Math.floor(
    (Date.parse(`${range.lastDay}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000,
  );
  const first = addDays(range.lastDay, -7 * Math.floor(fromEnd / 7) - 6);
  // The oldest bucket starts where the range does, not seven days before it.
  return first < range.from ? range.from : first;
}

/* -------------------------------------------------------------------------- */
/* §5 — the days of the week                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Occupancy and revenue for each weekday.
 *
 * Occupancy comes from the calendar; revenue is each booking's `subtotal`
 * spread evenly across the days it occupies and then attributed to those days'
 * weekdays. Spreading rather than crediting the whole stay to its check-in day
 * is what makes "Friday earns most" a statement about Fridays rather than about
 * when people happen to arrive.
 */
function buildDayOfWeek(
  confirmed: BookingRow[],
  calendar: Calendar,
  range: DateRange,
): DayOfWeekPoint[] {
  const revenueByDow = new Array(7).fill(0) as number[];

  for (const booking of confirmed) {
    const days = stayDays(booking);
    if (days.length === 0) continue;
    const perDay = booking.subtotal / days.length;
    for (const day of days) {
      // Only days inside the window, so this panel describes the period on
      // screen rather than spilling a long stay past its edge.
      if (day < range.from || day >= range.to) continue;
      revenueByDow[dayOfWeek(day)] += perDay;
    }
  }

  return Array.from({ length: 7 }, (_, day) => ({
    day,
    occupancyPct: pct(calendar.bookedByDow[day], calendar.capacityByDow[day]),
    revenue: Math.round(revenueByDow[day]),
    bookedDays: calendar.bookedByDow[day],
    capacityDays: calendar.capacityByDow[day],
  }));
}

/* -------------------------------------------------------------------------- */
/* §6 — with and without an overnight stay                                    */
/* -------------------------------------------------------------------------- */

function splitByStayType(confirmed: BookingRow[]): {
  overnight: StayTypeSplit;
  dayUse: StayTypeSplit;
} {
  const split = (rows: BookingRow[]): StayTypeSplit => {
    const revenue = sum(rows.map((r) => r.subtotal));
    return {
      bookings: rows.length,
      revenue,
      avgValue: rows.length > 0 ? Math.round(revenue / rows.length) : null,
    };
  };

  return {
    overnight: split(confirmed.filter((b) => !b.dayUse)),
    dayUse: split(confirmed.filter((b) => b.dayUse)),
  };
}

/* -------------------------------------------------------------------------- */
/* §7 — where the days came from                                              */
/* -------------------------------------------------------------------------- */

/**
 * Which channel produced the business.
 *
 * ─── Two things are being counted, and the table says which is which ─────────
 * `bookings`, `revenue` and `days` all come from RECORDED bookings — rows in
 * `BookingRequest`, each carrying the channel it came from in `source`. That is
 * true of a stay booked here, one the owner took over WhatsApp, and one taken
 * on Airbnb and entered by hand: all three know what they were worth.
 *
 * `unrecordedDays` is the remainder — days an imported iCal feed closed with no
 * booking recorded behind them. A feed carries dates and a title and no price
 * at all, so those days have no revenue, and none is invented for them by
 * multiplying nights by the listing's asking price. Reported separately rather
 * than folded in, because "Airbnb earned you 5,200 across 6 days, and closed 9
 * more you haven't recorded" is actionable and a single blended number is not.
 *
 * ─── The basis of the days column ────────────────────────────────────────────
 * Deliberately the days those bookings OCCUPY inside the period, not the
 * calendar's own count — the same basis §5 uses, and the only one that can be
 * attributed to a channel at all, since an `Availability` row knows which feed
 * closed a day but not which booking. The consequence, stated plainly: a stay
 * that began before the period still closes days inside it, and those days are
 * not counted here. So this column does not have to equal §4's booked days, and
 * the two are answering different questions.
 *
 * Rows may also overlap on a day: one sold here AND present in an Airbnb feed
 * is counted by both, which is the honest answer to "what closed this day" and
 * the reason the column is never presented as a total.
 */
function buildSources(
  confirmed: BookingRow[],
  availability: AvailabilityRow[],
  platformByFeed: Map<string, string>,
  range: DateRange,
): SourceRow[] {
  const bookings = new Map<BookingSource, { count: number; revenue: number }>();
  const daysBySource = new Map<BookingSource, Set<string>>();

  for (const booking of confirmed) {
    const source = toBookingSource(booking.source);

    const totals = bookings.get(source) ?? { count: 0, revenue: 0 };
    totals.count += 1;
    totals.revenue += booking.subtotal;
    bookings.set(source, totals);

    const days = daysBySource.get(source) ?? new Set<string>();
    for (const day of stayDays(booking)) {
      // Only days inside the window, so this panel describes the period on
      // screen rather than spilling a long stay past its edge.
      if (day < range.from || day >= range.to) continue;
      days.add(`${booking.listingId}|${day}`);
    }
    daysBySource.set(source, days);
  }

  // Imported days per platform, de-duplicated on (listing, day): two feeds from
  // the same platform closing one day is one night off the market, not two.
  const feedDays = new Map<CalendarPlatform, Set<string>>();
  for (const row of availability) {
    if (row.status !== "EXTERNAL") continue;
    const platform = resolvePlatform(row.feedId, platformByFeed);
    const set = feedDays.get(platform) ?? new Set<string>();
    set.add(`${row.listingId}|${row.date}`);
    feedDays.set(platform, set);
  }

  const rows: SourceRow[] = [];

  // In the vocabulary's own order, so the table reads the same way every time
  // rather than reordering itself as one channel overtakes another.
  for (const source of BOOKING_SOURCES) {
    const totals = bookings.get(source);
    const recorded = daysBySource.get(source) ?? new Set<string>();

    // A day the feed closed AND a recorded booking covers is not unrecorded.
    // Matched on (listing, day) rather than on identity, because a feed entry
    // has no identity to match on — see the note in actions/manual-booking.ts.
    const imported = isCalendarPlatform(source) ? feedDays.get(source) : undefined;
    const unrecordedDays = imported
      ? [...imported].filter((key) => !recorded.has(key)).length
      : 0;

    if (!totals && unrecordedDays === 0) continue;

    rows.push({
      key: source,
      bookings: totals?.count ?? 0,
      revenue: totals?.revenue ?? 0,
      days: recorded.size,
      unrecordedDays,
    });
  }

  return rows;
}

function resolvePlatform(
  feedId: string | null,
  platformByFeed: Map<string, string>,
): CalendarPlatform {
  const raw = feedId ? platformByFeed.get(feedId) : undefined;
  // A feed row whose platform this build does not recognise still closed a day,
  // so it lands in "OTHER" rather than being dropped from the table.
  return isCalendarPlatform(raw) ? raw : "OTHER";
}

/* -------------------------------------------------------------------------- */
/* §8 — what the days actually went for                                       */
/* -------------------------------------------------------------------------- */

/**
 * The realised rates, not the asking prices.
 *
 * `Listing.pricePerNight` is what the rest house asks; this is what its days
 * were sold for once day-use rates, special days and whatever the owner settled
 * on over WhatsApp had their effect. Each booking's `subtotal` is spread across
 * the days it occupies and each of those days is filed as a weekday or a
 * weekend day according to ITS OWN listing's weekend — a Sharjah rest house and
 * a Dubai one on the same owner's account do not share a Sunday.
 */
function buildPricing(
  confirmed: BookingRow[],
  calendar: Calendar,
  weekendByListing: Map<string, WeekendMode>,
): PricingBreakdown {
  let weekendRevenue = 0;
  let weekendDays = 0;
  let weekdayRevenue = 0;
  let weekdayDays = 0;

  for (const booking of confirmed) {
    const days = stayDays(booking);
    if (days.length === 0) continue;
    const perDay = booking.subtotal / days.length;
    const mode = weekendByListing.get(booking.listingId) ?? DEFAULT_WEEKEND_MODE;

    for (const day of days) {
      if (isWeekend(day, mode)) {
        weekendRevenue += perDay;
        weekendDays += 1;
      } else {
        weekdayRevenue += perDay;
        weekdayDays += 1;
      }
    }
  }

  const revenue = sum(confirmed.map((b) => b.subtotal));

  return {
    weekdayRate: weekdayDays > 0 ? Math.round(weekdayRevenue / weekdayDays) : null,
    weekendRate: weekendDays > 0 ? Math.round(weekendRevenue / weekendDays) : null,
    weekdayOccupancyPct: calendar.weekdayOccupancyPct,
    weekendOccupancyPct: calendar.weekendOccupancyPct,
    avgBookingValue: confirmed.length > 0 ? Math.round(revenue / confirmed.length) : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Per rest house                                                             */
/* -------------------------------------------------------------------------- */

function buildListingRows(
  confirmed: BookingRow[],
  calendar: Calendar,
  listings: ScopedListing[],
  range: DateRange,
): ListingRow[] {
  const rows = listings.map((listing) => {
    const mine = confirmed.filter((b) => b.listingId === listing.id);
    const booked = calendar.bookedByListing.get(listing.id) ?? 0;
    return {
      id: listing.id,
      name: listing.name,
      nameEn: listing.nameEn,
      published: listing.published,
      bookings: mine.length,
      revenue: sum(mine.map((b) => b.subtotal)),
      // One listing can only be occupied for as many days as the period has.
      occupancyPct: pct(booked, range.days),
      bookedDays: booked,
    };
  });

  rows.sort((a, b) => b.revenue - a.revenue || b.bookings - a.bookings);
  return rows;
}

/* -------------------------------------------------------------------------- */
/* §9 — what the numbers are worth saying out loud                            */
/* -------------------------------------------------------------------------- */

/**
 * Only what the figures support, and only where there is something to do about
 * it. Each has a threshold and stays silent below it — an advice strip that
 * always has something to say is one an owner stops reading.
 */
function buildAlerts(
  confirmed: BookingRow[],
  calendar: Calendar,
  listings: ScopedListing[],
): AnalyticsAlert[] {
  const alerts: AnalyticsAlert[] = [];

  if (calendar.capacityDays === 0 || (confirmed.length === 0 && calendar.bookedDays === 0)) {
    return [{ key: "noData", tone: "opportunity" }];
  }

  // Best and worst weekday, but only once each weekday has come round often
  // enough for the comparison to mean anything. Over a seven-day period every
  // weekday has a sample of one, and the "quietest day" would be whichever one
  // happened to be empty.
  const ranked = calendar.capacityByDow
    .map((capacity, day) => ({
      day,
      capacity,
      pct: pct(calendar.bookedByDow[day], capacity),
    }))
    .filter((row) => row.capacity >= 3 * listings.length);

  if (ranked.length >= 2) {
    const best = ranked.reduce((a, b) => (b.pct > a.pct ? b : a));
    const worst = ranked.reduce((a, b) => (b.pct < a.pct ? b : a));
    if (best.pct > worst.pct) {
      alerts.push({ key: "bestDay", tone: "good", day: best.day, pct: best.pct });
      alerts.push({ key: "worstDay", tone: "opportunity", day: worst.day, pct: worst.pct });
    }
  }

  // A price rise is only worth raising where the owner is leaving money on the
  // table — a listing that fills at the weekend and charges Friday what it
  // charges Monday.
  const flatWeekend = listings.some(
    (l) => l.weekendPrice === 0 || l.weekendPrice <= l.pricePerNight,
  );
  if (calendar.weekendOccupancyPct >= 70 && flatWeekend) {
    alerts.push({
      key: "raisePrice",
      tone: "opportunity",
      pct: calendar.weekendOccupancyPct,
    });
  }

  if (calendar.availableDays > 0) {
    alerts.push({
      key: "emptyDays",
      tone: calendar.availableDays > calendar.bookedDays ? "urgent" : "opportunity",
      count: calendar.availableDays,
    });

    // What those empty days would be worth at the rate this period actually
    // achieved — the realised average, not the asking price, so the estimate is
    // anchored to what guests have been paying rather than to a hope.
    //
    // It is still a CEILING, not a forecast: it assumes every remaining day
    // sells. On a scope with eight rest houses that is a number in the hundreds
    // of thousands sitting next to actual revenue in the hundreds, so the
    // wording in the dictionary states the assumption out loud. An estimate that
    // reads as a projection is worse than no estimate.
    const soldDays = sum(confirmed.map((b) => stayDays(b).length));
    const realised = soldDays > 0 ? sum(confirmed.map((b) => b.subtotal)) / soldDays : 0;
    if (realised > 0) {
      alerts.push({
        key: "potentialRevenue",
        tone: "opportunity",
        count: calendar.availableDays,
        amount: Math.round(realised * calendar.availableDays),
      });
    }
  }

  return alerts;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The calendar days a booking takes off the market.
 *
 * Always through `occupiedDays`, which returns the single day for a day-use
 * booking where `nightsInRange` would return nothing at all.
 */
function stayDays(booking: BookingRow): ISODate[] {
  return occupiedDays(booking.checkIn, booking.checkOut, booking.dayUse);
}

function sum(values: number[]): number {
  return values.reduce((total, v) => total + v, 0);
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** A scope with no rest houses in it — every figure zero, nothing invented. */
function emptyAnalytics(period: ResolvedPeriod): Analytics {
  const zeroKpis: Kpis = {
    revenue: 0,
    netRevenue: 0,
    bookings: 0,
    occupancyPct: 0,
    avgBookingValue: null,
    avgDailyRate: null,
    bookedDays: 0,
    availableDays: 0,
    cancellationPct: null,
  };
  const zeroSplit: StayTypeSplit = { bookings: 0, revenue: 0, avgValue: null };

  return {
    range: period.range,
    previous: period.previous,
    kpis: zeroKpis,
    priorKpis: zeroKpis,
    trend: [],
    bucket: bucketFor(period.range.days),
    bookedDays: 0,
    blockedDays: 0,
    availableDays: 0,
    capacityDays: 0,
    weekdayOccupancyPct: 0,
    weekendOccupancyPct: 0,
    byDayOfWeek: Array.from({ length: 7 }, (_, day) => ({
      day,
      occupancyPct: 0,
      revenue: 0,
      bookedDays: 0,
      capacityDays: 0,
    })),
    overnight: zeroSplit,
    dayUse: zeroSplit,
    sources: [],
    pricing: {
      weekdayRate: null,
      weekendRate: null,
      weekdayOccupancyPct: 0,
      weekendOccupancyPct: 0,
      avgBookingValue: null,
    },
    listings: [],
    alerts: [{ key: "noData", tone: "opportunity" }],
    listingCount: 0,
    truncated: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Change against the previous period                                         */
/* -------------------------------------------------------------------------- */

export type Change = {
  /** Percentage change, or null when the previous period had nothing to grow from. */
  pct: number | null;
  /** Raw difference, which is the right reading when both sides are percentages. */
  points: number;
  direction: "up" | "down" | "flat";
};

/**
 * How a figure moved.
 *
 * Both readings are returned rather than one, because which is meaningful
 * depends on what was measured: revenue rising from 10,000 to 12,000 is "+20%",
 * while occupancy rising from 50% to 60% is "+10 points" and emphatically not
 * "+20%". The caller picks; the label beside it says which it picked.
 */
export function change(current: number, previous: number): Change {
  const points = current - previous;
  return {
    pct: previous > 0 ? Math.round((points / previous) * 100) : null,
    points,
    direction: points > 0 ? "up" : points < 0 ? "down" : "flat",
  };
}
