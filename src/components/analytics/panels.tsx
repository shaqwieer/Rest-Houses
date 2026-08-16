import Link from "next/link";
import clsx from "clsx";
import { Icon, type IconName } from "@/components/ui/icon";
import { arDelta, arDeltaPercent, arNum, arPercent } from "@/lib/format";
import { addDays, arDayMonth, arMonthLabel, parseISODate } from "@/lib/dates";
import { CALENDAR_PLATFORM_NAMES, dayNames, monthNames } from "@/lib/constants";
import { change, type Change } from "@/lib/analytics";
import { localized, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n";
import type {
  Analytics,
  AnalyticsAlert,
  DayOfWeekPoint,
  Kpis,
  ListingRow,
  PricingBreakdown,
  SourceRow,
  StayTypeSplit,
  TimePoint,
  TrendBucket,
} from "@/lib/analytics";

/**
 * The panels of the performance dashboard.
 *
 * All server components, and no charting library — for the same reason
 * src/components/owner/insight-panels.tsx has none: a bar is a div with a
 * height, and shipping a charting bundle to an owner checking their phone on
 * mobile data would be a poor trade for what these draw.
 *
 * ─── Chart conventions, inherited from the owner panels ──────────────────────
 * • One measure per plot, and where a second measure was tempting (§3) the
 *   answer is a card rather than a second track: money and counts cannot share
 *   an axis, and stacking their scales only moves the problem into the reader.
 * • One hue per measure, taken from the accent the operator sets in
 *   /admin/settings, so a rebrand carries the charts with it.
 * • Direction is never mirrored by hand. A flex row in an RTL document already
 *   starts at the right, so the oldest bucket sits where an Arabic reader
 *   begins and where an English reader begins, from the same markup.
 * • Every bar carries an `aria-label` with its full reading, because only the
 *   peak is labelled visually.
 */

const CARD = "rounded-[20px] border border-line bg-surface p-4 shadow-e1";
const HEADING = "m-0 font-display text-[15.5px] font-extrabold text-ink";
const SUB = "m-0 mb-3.5 text-[11.5px] text-muted";

/* -------------------------------------------------------------------------- */
/* §1 — the headline cards                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How a figure moved, in one line under it.
 *
 * `mode` decides the reading, and it is not cosmetic: revenue going from 10,000
 * to 12,000 is "+20%", while occupancy going from 50% to 60% is "+10 points"
 * and very much not "+20%". `goodDirection` flips the colour for the one
 * measure where rising is bad.
 */
function ChangeLine({
  delta,
  mode,
  goodDirection = "up",
  t,
  locale,
}: {
  delta: Change;
  mode: "pct" | "points";
  goodDirection?: "up" | "down";
  t: Dictionary;
  locale: Locale;
}) {
  // Nothing to compare against: the previous period was empty, and "+∞%" is not
  // a number anyone can act on.
  if (mode === "pct" && delta.pct === null) return null;
  if (delta.direction === "flat") return null;

  const good = delta.direction === goodDirection;
  const text =
    mode === "pct"
      ? arDeltaPercent(delta.pct ?? 0, locale)
      : `${arDelta(delta.points, locale)} ${t.analytics.pointsUnit}`;

  return (
    <div
      className={clsx(
        "mt-1 text-[11px] font-bold",
        good ? "text-ok" : "text-busy",
      )}
    >
      {text} <span className="font-medium text-muted">{t.analytics.vsPrevious}</span>
    </div>
  );
}

/**
 * One figure, in one of two weights.
 *
 * `primary` is the three an owner came to the page for — how much, how many, how
 * full. The other five are the same card at a smaller size: still there for the
 * operator, who reads this looking for a margin or a cancellation rate, but no
 * longer competing with the three for the first glance. Eight cards of equal
 * weight is eight things to read and no answer.
 */
function KpiCard({
  label,
  value,
  sub,
  icon,
  primary = false,
  className,
  children,
}: {
  label: string;
  value: string;
  sub: string;
  icon: IconName;
  primary?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={clsx(CARD, primary && "sm:p-5", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className={clsx("font-semibold text-muted", primary ? "text-[12.5px]" : "text-[11.5px]")}
        >
          {label}
        </span>
        <Icon name={icon} size={primary ? 21 : 17} className="text-gold-600" />
      </div>
      <div
        className={clsx(
          "font-display font-extrabold leading-none text-ink",
          primary ? "text-[27px] sm:text-[31px]" : "text-[19px]",
        )}
      >
        {value}
      </div>
      <div className={clsx("mt-1 text-muted", primary ? "text-[11.5px]" : "text-[10.5px]")}>
        {sub}
      </div>
      {children}
    </div>
  );
}

export function KpiGrid({
  kpis,
  prior,
  t,
  locale,
}: {
  kpis: Kpis;
  prior: Kpis;
  t: Dictionary;
  locale: Locale;
}) {
  const dash = t.common.none;
  const money = (n: number | null) => (n === null ? dash : arNum(n, locale));

  return (
    <div className="flex flex-col gap-2.5">
      {/* ---- the three an owner opens the page for ----
          On a phone the money gets the full width and the other two share the
          row under it, rather than three columns of 120px where the figure an
          owner came for is the same size as everything else. */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <KpiCard
          label={t.analytics.revenue}
          value={arNum(kpis.revenue, locale)}
          sub={t.analytics.revenueSub}
          icon="payments"
          className="col-span-2 sm:col-span-1"
          primary
        >
          <ChangeLine
            delta={change(kpis.revenue, prior.revenue)}
            mode="pct"
            t={t}
            locale={locale}
          />
        </KpiCard>

        <KpiCard
          label={t.analytics.bookings}
          value={arNum(kpis.bookings, locale)}
          sub={t.analytics.bookingsSub}
          icon="task_alt"
          primary
        >
          <ChangeLine
            delta={change(kpis.bookings, prior.bookings)}
            mode="pct"
            t={t}
            locale={locale}
          />
        </KpiCard>

        <KpiCard
          label={t.analytics.occupancy}
          value={arPercent(kpis.occupancyPct, locale)}
          sub={t.analytics.occupancySub}
          icon="donut_large"
          primary
        >
          {/* Points, not percent — the gap between two percentages is not a ratio. */}
          <ChangeLine
            delta={change(kpis.occupancyPct, prior.occupancyPct)}
            mode="points"
            t={t}
            locale={locale}
          />
        </KpiCard>
      </div>

      {/* ---- the five behind them ---- */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
        <KpiCard
          label={t.analytics.netRevenue}
          value={arNum(kpis.netRevenue, locale)}
          sub={t.analytics.netRevenueSub}
          icon="savings"
        >
          <ChangeLine
            delta={change(kpis.netRevenue, prior.netRevenue)}
            mode="pct"
            t={t}
            locale={locale}
          />
        </KpiCard>

        <KpiCard
          label={t.analytics.avgBookingValue}
          value={money(kpis.avgBookingValue)}
          sub={t.analytics.avgBookingValueSub}
          icon="confirmation_number"
        >
          <ChangeLine
            delta={change(kpis.avgBookingValue ?? 0, prior.avgBookingValue ?? 0)}
            mode="pct"
            t={t}
            locale={locale}
          />
        </KpiCard>

        <KpiCard
          label={t.analytics.avgDailyRate}
          value={money(kpis.avgDailyRate)}
          sub={t.analytics.avgDailyRateSub}
          icon="credit_card"
        >
          <ChangeLine
            delta={change(kpis.avgDailyRate ?? 0, prior.avgDailyRate ?? 0)}
            mode="pct"
            t={t}
            locale={locale}
          />
        </KpiCard>

        <KpiCard
          label={t.analytics.daysSplit}
          value={t.analytics.daysSplitValue(
            arNum(kpis.bookedDays, locale),
            arNum(kpis.availableDays, locale),
          )}
          sub={t.analytics.daysSplitSub}
          icon="calendar_month"
        />

        <KpiCard
          label={t.analytics.cancellation}
          value={kpis.cancellationPct === null ? dash : arPercent(kpis.cancellationPct, locale)}
          sub={t.analytics.cancellationSub}
          icon="event_busy"
        >
          {/* The one measure where a rise is bad news. */}
          <ChangeLine
            delta={change(kpis.cancellationPct ?? 0, prior.cancellationPct ?? 0)}
            mode="points"
            goodDirection="down"
            t={t}
            locale={locale}
          />
        </KpiCard>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* §3 — revenue over the period                                               */
/* -------------------------------------------------------------------------- */

/** What one bucket is called on the axis. */
function pointLabel(key: string, bucket: TrendBucket, locale: Locale): string {
  if (bucket === "month") {
    const date = parseISODate(key);
    return monthNames(locale)[date.getUTCMonth()];
  }
  if (bucket === "week") return arDayMonth(key, locale);
  return arNum(Number(key.slice(8, 10)), locale);
}

/**
 * Revenue per bucket, and nothing else.
 *
 * ─── Why one measure and not three ───────────────────────────────────────────
 * This drew revenue, occupancy on a second track and the booking count in the
 * legend. Three measures is three readings, and an owner opening this on a phone
 * wants one: how much did I make, and is it going up. Bookings and occupancy did
 * not leave the page — they are headline cards above, where a single number is
 * read faster than a shape. What each bar is worth in every measure is still in
 * its `title` and `aria-label`, and the spreadsheet export still carries all
 * three columns, so nothing here is information that went missing.
 */
export function RevenueTrend({
  trend,
  bucket,
  t,
  locale,
}: {
  trend: TimePoint[];
  bucket: TrendBucket;
  t: Dictionary;
  locale: Locale;
}) {
  const peak = Math.max(...trend.map((p) => p.revenue), 0);
  const hasRevenue = peak > 0;

  // Whether every bar can carry its own value and its own label. Five weekly
  // bars can; fourteen daily bars cannot, so those print the peak alone and thin
  // the axis. Every reading stays in the `aria-label` either way.
  const roomy = trend.length <= 8;
  const stride = roomy ? 1 : Math.max(1, Math.ceil(trend.length / 7));

  const reading = (point: TimePoint) =>
    t.analytics.trendPoint(
      pointLabelLong(point, bucket, t, locale),
      arNum(point.revenue, locale),
      arNum(point.bookings, locale),
      arPercent(point.occupancyPct, locale),
    );

  return (
    <div className={CARD}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className={HEADING}>{t.analytics.trendTitle}</h2>
        <span className="text-[11px] text-muted">{t.common.aed}</span>
      </div>
      <p className={SUB}>{t.analytics.trendSub[bucket]}</p>

      {trend.length === 0 || !hasRevenue ? (
        <p className="m-0 py-6 text-center text-[13px] text-muted">{t.analytics.trendEmpty}</p>
      ) : (
        <>
          <div className="flex h-[150px] items-stretch gap-[3px]">
            {trend.map((point) => {
              const share = (point.revenue / peak) * 100;
              // An empty bucket is left unlabelled: a printed "٠" over a flat
              // bar is a number to read for something the track already says.
              const printed = roomy ? point.revenue > 0 : point.revenue === peak;
              return (
                <div key={point.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span
                    className={clsx(
                      "h-4 font-bold text-bronze",
                      roomy ? "text-[10.5px]" : "text-[9px]",
                    )}
                  >
                    {printed ? arNum(point.revenue, locale) : ""}
                  </span>
                  {/* A full-height track, so an empty bucket reads as empty
                      rather than as a very small value. Capped in width so five
                      bars on a desktop card are bars and not slabs. */}
                  <div
                    className="relative w-full max-w-[72px] flex-1 overflow-hidden rounded-[6px] bg-sand-100"
                    title={reading(point)}
                  >
                    <div
                      role="img"
                      aria-label={reading(point)}
                      className="absolute inset-x-0 bottom-0 rounded-[6px] bg-gold-500"
                      style={{ height: `${share}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-1.5 flex gap-[3px]">
            {trend.map((point, index) => (
              <span
                key={point.key}
                className="min-w-0 flex-1 truncate text-center text-[10px] text-muted"
              >
                {index % stride === 0 ? pointLabel(point.key, bucket, locale) : ""}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The long form used in tooltips and screen-reader labels.
 *
 * A week says the days it covers, which is what keeps the short bucket at the
 * oldest end of a range honest: a two-day bar beside four week-long ones reads
 * as a collapse until its label says it is two days.
 *
 * A month is named instead, even when the range clips it. A monthly bucket is
 * keyed by the 1st whether or not the range starts there, so the span arithmetic
 * that works for a week would announce a February clipped to its last eleven
 * days as "1 – 11 February". The month's name is the reading that stays true.
 */
function pointLabelLong(
  point: TimePoint,
  bucket: TrendBucket,
  t: Dictionary,
  locale: Locale,
): string {
  if (bucket === "day") return arDayMonth(point.key, locale);
  if (bucket === "month") {
    const date = parseISODate(point.key);
    return arMonthLabel(date.getUTCFullYear(), date.getUTCMonth(), locale);
  }
  return t.analytics.rangeLine(
    arDayMonth(point.key, locale),
    arDayMonth(addDays(point.key, point.days - 1), locale),
  );
}

/* -------------------------------------------------------------------------- */
/* §4 — how the calendar was spent                                            */
/* -------------------------------------------------------------------------- */

export function OccupancyBreakdown({
  values,
  t,
  locale,
}: {
  values: Pick<
    Analytics,
    | "bookedDays"
    | "blockedDays"
    | "availableDays"
    | "capacityDays"
    | "weekdayOccupancyPct"
    | "weekendOccupancyPct"
  >;
  t: Dictionary;
  locale: Locale;
}) {
  const total = Math.max(1, values.capacityDays);
  const segments = [
    { label: t.analytics.bookedDays, days: values.bookedDays, className: "bg-gold-500" },
    { label: t.analytics.blockedDays, days: values.blockedDays, className: "bg-bronze/45" },
    { label: t.analytics.availableDays, days: values.availableDays, className: "bg-sand-200" },
  ];

  return (
    <div className={CARD}>
      <h2 className={HEADING}>{t.analytics.occupancyTitle}</h2>
      <p className={SUB}>{t.analytics.occupancyBreakdownSub}</p>

      {/* The three buckets are a breakdown of capacity and sum to it exactly —
          a day that is both sold and blocked counts once, as sold. */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-sand-100" aria-hidden>
        {segments.map((segment) => (
          <div
            key={segment.label}
            className={segment.className}
            style={{ width: `${(segment.days / total) * 100}%` }}
          />
        ))}
      </div>

      <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center gap-2 text-[12.5px]">
            <span
              className={clsx("inline-block size-2.5 shrink-0 rounded-[3px]", segment.className)}
              aria-hidden
            />
            <span className="flex-1 text-muted">{segment.label}</span>
            <span className="font-bold text-ink">
              {arNum(segment.days, locale)} {t.analytics.dayUnit}
            </span>
          </li>
        ))}
        <li className="flex items-center gap-2 border-t border-line pt-2 text-[12.5px]">
          <span className="flex-1 text-muted">{t.analytics.capacityDays}</span>
          <span className="font-bold text-ink">
            {arNum(values.capacityDays, locale)} {t.analytics.dayUnit}
          </span>
        </li>
      </ul>

      <div className="mt-3.5 grid grid-cols-2 gap-2.5">
        <MiniStat
          label={t.analytics.weekdayOccupancy}
          value={arPercent(values.weekdayOccupancyPct, locale)}
          pct={values.weekdayOccupancyPct}
        />
        <MiniStat
          label={t.analytics.weekendOccupancy}
          value={arPercent(values.weekendOccupancyPct, locale)}
          pct={values.weekendOccupancyPct}
        />
      </div>
    </div>
  );
}

function MiniStat({ label, value, pct }: { label: string; value: string; pct?: number }) {
  return (
    <div className="rounded-2xl border border-line bg-sand-50 p-3">
      <div className="truncate text-[11px] font-semibold text-muted">{label}</div>
      <div className="mt-1 font-display text-[17px] font-extrabold leading-none text-ink">
        {value}
      </div>
      {pct !== undefined && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sand-200">
          <div
            className="h-full rounded-full bg-gold-500"
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* §5 — the days of the week                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Rows rather than columns.
 *
 * Each day carries two measures — occupancy and revenue — and seven columns on
 * a 360px phone leaves about forty pixels for both. Rows give the bar its full
 * width and put the money where it can be read, which is the whole point of the
 * panel: which days are worth pricing up.
 */
export function DayOfWeekPanel({
  rows,
  t,
  locale,
}: {
  rows: DayOfWeekPoint[];
  t: Dictionary;
  locale: Locale;
}) {
  const names = dayNames(locale);
  const peak = Math.max(...rows.map((r) => r.occupancyPct), 0);

  return (
    <div className={CARD}>
      <h2 className={HEADING}>{t.analytics.dowTitle}</h2>
      <p className={SUB}>{t.analytics.dowSub}</p>

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((row) => (
          <li
            key={row.day}
            className="flex items-center gap-3"
            aria-label={t.analytics.dowRow(
              names[row.day],
              arPercent(row.occupancyPct, locale),
              arNum(row.revenue, locale),
            )}
          >
            <span className="w-[62px] shrink-0 truncate text-[12px] font-semibold text-muted">
              {names[row.day]}
            </span>
            <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-sand-100">
              <span
                className={clsx(
                  "block h-full rounded-full",
                  // The busiest day is the one the owner is looking for; the
                  // rest are context for it.
                  row.occupancyPct === peak && peak > 0 ? "bg-gold-500" : "bg-sand-300",
                )}
                style={{ width: `${Math.min(100, row.occupancyPct)}%` }}
              />
            </span>
            <span className="w-[38px] shrink-0 text-end text-[12px] font-bold text-ink">
              {arPercent(row.occupancyPct, locale)}
            </span>
            <span className="w-[74px] shrink-0 text-end text-[11.5px] text-bronze">
              {arNum(row.revenue, locale)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* §6 — with and without an overnight stay                                    */
/* -------------------------------------------------------------------------- */

export function StayTypePanel({
  overnight,
  dayUse,
  t,
  locale,
}: {
  overnight: StayTypeSplit;
  dayUse: StayTypeSplit;
  t: Dictionary;
  locale: Locale;
}) {
  const column = (label: string, icon: IconName, split: StayTypeSplit) => (
    <div className="rounded-2xl border border-line bg-sand-50 p-3.5">
      <div className="mb-2.5 flex items-center gap-1.5">
        <Icon name={icon} size={17} className="text-gold-600" />
        <span className="truncate text-[12px] font-semibold text-muted">{label}</span>
      </div>
      <dl className="m-0 flex flex-col gap-1.5 text-[12.5px]">
        <div className="flex justify-between gap-2">
          <dt className="text-muted">{t.analytics.bookings}</dt>
          <dd className="m-0 font-bold text-ink">{arNum(split.bookings, locale)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">{t.analytics.colRevenue}</dt>
          <dd className="m-0 font-bold text-ink">
            {arNum(split.revenue, locale)} {t.common.aed}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">{t.analytics.avgBookingValue}</dt>
          <dd className="m-0 font-bold text-ink">
            {split.avgValue === null ? t.common.none : arNum(split.avgValue, locale)}
          </dd>
        </div>
      </dl>
    </div>
  );

  return (
    <div className={CARD}>
      <h2 className={HEADING}>{t.analytics.stayTypeTitle}</h2>
      <p className={SUB}>{t.analytics.stayTypeSub}</p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {column(t.analytics.overnight, "cabin", overnight)}
        {column(t.analytics.dayUse, "schedule", dayUse)}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* §7 — where the days came from                                              */
/* -------------------------------------------------------------------------- */

export function SourcesPanel({
  sources,
  t,
  locale,
}: {
  sources: SourceRow[];
  t: Dictionary;
  locale: Locale;
}) {
  const name = (row: SourceRow) => {
    if (row.key === "RIHLA") return t.analytics.sourceRihla;
    if (row.key === "DIRECT") return t.analytics.sourceDirect;
    // Airbnb and Booking.com are proper nouns and identical in both languages —
    // see the note on CALENDAR_PLATFORM_NAMES. Only "OTHER" needs translating.
    return CALENDAR_PLATFORM_NAMES[row.key] || t.calendar.platformOther;
  };

  return (
    <div className={CARD}>
      <h2 className={HEADING}>{t.analytics.sourcesTitle}</h2>
      <p className={SUB}>{t.analytics.sourcesSub}</p>

      {sources.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">{t.analytics.sourcesEmpty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="text-[11px] font-bold text-muted">
                <th className="pb-2 text-start font-bold">{t.analytics.sourcesTitle}</th>
                <th className="pb-2 text-start font-bold">{t.analytics.sourceDaysCol}</th>
                <th className="pb-2 text-start font-bold">{t.analytics.sourceBookingsCol}</th>
                <th className="pb-2 text-start font-bold">{t.analytics.sourceRevenueCol}</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((row) => (
                <tr key={row.key} className="border-t border-line">
                  <td className="py-2.5 pe-3 font-bold text-ink">{name(row)}</td>
                  <td className="py-2.5 pe-3 text-muted">
                    {arNum(row.days, locale)}
                    {/* The part of this channel whose money is still unknown,
                        beside the part that is known rather than blended into
                        it — a feed carries dates and no prices. */}
                    {row.unrecordedDays > 0 && (
                      <span className="ms-1 text-[11px] text-off">
                        {t.analytics.plusImported(arNum(row.unrecordedDays, locale))}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pe-3 text-muted">{arNum(row.bookings, locale)}</td>
                  <td className="py-2.5 font-bold text-ink">
                    {row.bookings > 0 ? (
                      `${arNum(row.revenue, locale)} ${t.common.aed}`
                    ) : (
                      <span className="font-medium text-muted">{t.analytics.revenueUnknown}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="m-0 mt-3 text-[11px] leading-relaxed text-muted">{t.analytics.sourcesNote}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* §8 — what the days actually went for                                       */
/* -------------------------------------------------------------------------- */

export function PricingPanel({
  pricing,
  t,
  locale,
}: {
  pricing: PricingBreakdown;
  t: Dictionary;
  locale: Locale;
}) {
  const dash = t.common.none;

  return (
    <div className={CARD}>
      <h2 className={HEADING}>{t.analytics.pricingTitle}</h2>
      <p className={SUB}>{t.analytics.pricingSub}</p>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        <MiniStat
          label={t.analytics.weekdayRate}
          value={pricing.weekdayRate === null ? dash : arNum(pricing.weekdayRate, locale)}
        />
        <MiniStat
          label={t.analytics.weekendRate}
          value={pricing.weekendRate === null ? dash : arNum(pricing.weekendRate, locale)}
        />
        <MiniStat
          label={t.analytics.actualRate}
          value={
            pricing.avgBookingValue === null ? dash : arNum(pricing.avgBookingValue, locale)
          }
        />
        <MiniStat
          label={t.analytics.weekdayOccupancy}
          value={arPercent(pricing.weekdayOccupancyPct, locale)}
          pct={pricing.weekdayOccupancyPct}
        />
        <MiniStat
          label={t.analytics.weekendOccupancy}
          value={arPercent(pricing.weekendOccupancyPct, locale)}
          pct={pricing.weekendOccupancyPct}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Per rest house                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A table on a wide screen and a stack of cards on a phone — the same numbers,
 * laid out for the device rather than a table squeezed into 320px and scrolled
 * sideways.
 */
export function AnalyticsListingTable({
  rows,
  hrefFor,
  t,
  locale,
}: {
  rows: ListingRow[];
  /** Where a row links to, or null on a view that has nowhere to send it. */
  hrefFor?: (row: ListingRow) => string | null;
  t: Dictionary;
  locale: Locale;
}) {
  if (rows.length <= 1) return null;

  const name = (row: ListingRow) => localized(row.name, row.nameEn, locale);
  const link = (row: ListingRow) => hrefFor?.(row) ?? null;

  return (
    <div className={CARD}>
      <h2 className={clsx(HEADING, "mb-3.5")}>{t.analytics.listingsTitle}</h2>

      {/* ---- phones ---- */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {rows.map((row) => {
          const href = link(row);
          const body = (
            <>
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className="min-w-0 flex-1 text-[13.5px] font-bold text-ink">
                  {name(row)}
                  {!row.published && (
                    <span className="ms-1.5 rounded-full bg-sand-200 px-2 py-0.5 text-[10px] font-bold text-muted">
                      {t.analytics.hiddenListing}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-display text-[14px] font-extrabold text-bronze">
                  {arNum(row.revenue, locale)} {t.common.aed}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
                <span>
                  {t.analytics.colBookings}: {arNum(row.bookings, locale)}
                </span>
                <span>
                  {t.analytics.colOccupancy}: {arPercent(row.occupancyPct, locale)}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sand-200">
                <div
                  className="h-full rounded-full bg-gold-500"
                  style={{ width: `${Math.min(100, Math.max(0, row.occupancyPct))}%` }}
                />
              </div>
            </>
          );
          const className =
            "block rounded-2xl border border-line bg-sand-50 p-3 no-underline hover:no-underline";
          return href ? (
            <Link key={row.id} href={href} className={clsx(className, "hover:border-gold-500")}>
              {body}
            </Link>
          ) : (
            <div key={row.id} className={className}>
              {body}
            </div>
          );
        })}
      </div>

      {/* ---- wide screens ---- */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-[11.5px] font-bold text-muted">
              <th className="pb-2 text-start font-bold">{t.analytics.colListing}</th>
              <th className="pb-2 text-start font-bold">{t.analytics.colBookings}</th>
              <th className="pb-2 text-start font-bold">{t.analytics.colRevenue}</th>
              <th className="pb-2 text-start font-bold">{t.analytics.colOccupancy}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = link(row);
              return (
                <tr key={row.id} className="border-t border-line">
                  <td className="py-2.5 pe-3">
                    {href ? (
                      <Link
                        href={href}
                        className="font-bold text-ink no-underline hover:text-bronze hover:no-underline"
                      >
                        {name(row)}
                      </Link>
                    ) : (
                      <span className="font-bold text-ink">{name(row)}</span>
                    )}
                    {!row.published && (
                      <span className="ms-1.5 rounded-full bg-sand-200 px-2 py-0.5 text-[10px] font-bold text-muted">
                        {t.analytics.hiddenListing}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pe-3 text-muted">{arNum(row.bookings, locale)}</td>
                  <td className="py-2.5 pe-3 font-bold text-ink">
                    {arNum(row.revenue, locale)} {t.common.aed}
                  </td>
                  <td className="w-[130px] py-2.5">
                    <div className="mb-1 text-[12px] font-semibold text-ink">
                      {arPercent(row.occupancyPct, locale)}
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sand-200">
                      <div
                        className="h-full rounded-full bg-gold-500"
                        style={{ width: `${Math.min(100, Math.max(0, row.occupancyPct))}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* §9 — the alerts                                                            */
/* -------------------------------------------------------------------------- */

const ALERT_STYLES: Record<
  AnalyticsAlert["tone"],
  { box: string; icon: IconName; iconClass: string }
> = {
  urgent: { box: "border-busy/30 bg-busy-bg", icon: "warning", iconClass: "text-busy" },
  opportunity: { box: "border-gold-300 bg-gold-100/60", icon: "bolt", iconClass: "text-bronze" },
  good: { box: "border-ok/30 bg-ok-bg", icon: "local_fire_department", iconClass: "text-ok" },
};

function alertText(alert: AnalyticsAlert, t: Dictionary, locale: Locale): string {
  const names = dayNames(locale);
  const pct = arPercent(alert.pct ?? 0, locale);

  switch (alert.key) {
    case "bestDay":
      return t.analytics.alertBestDay(names[alert.day ?? 0], pct);
    case "worstDay":
      return t.analytics.alertWorstDay(names[alert.day ?? 0], pct);
    case "raisePrice":
      return t.analytics.alertRaisePrice(pct);
    case "emptyDays":
      return t.analytics.alertEmptyDays(arNum(alert.count ?? 0, locale));
    case "potentialRevenue":
      return t.analytics.alertPotentialRevenue(
        arNum(alert.amount ?? 0, locale),
        arNum(alert.count ?? 0, locale),
      );
    case "noData":
      return t.analytics.alertNoData;
  }
}

export function AlertsPanel({
  alerts,
  t,
  locale,
}: {
  alerts: AnalyticsAlert[];
  t: Dictionary;
  locale: Locale;
}) {
  if (alerts.length === 0) return null;

  return (
    <div className={CARD}>
      <h2 className={clsx(HEADING, "mb-3")}>{t.analytics.alertsTitle}</h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {alerts.map((alert) => {
          const style = ALERT_STYLES[alert.tone];
          return (
            <li
              key={alert.key}
              className={clsx(
                "flex items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-[13px] leading-[1.7] text-ink",
                style.box,
              )}
            >
              <Icon
                name={style.icon}
                size={19}
                className={clsx("mt-0.5 shrink-0", style.iconClass)}
              />
              <span>{alertText(alert, t, locale)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Said out loud when a cap bit, because a silent truncation reads as a total. */
export function TruncatedNote({ t }: { t: Dictionary }) {
  return (
    <p className="m-0 flex items-center gap-2 rounded-xl bg-busy-bg px-3.5 py-2.5 text-[12.5px] font-semibold text-busy">
      <Icon name="warning" size={16} />
      {t.analytics.truncatedNote}
    </p>
  );
}
