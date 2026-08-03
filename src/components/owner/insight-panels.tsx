import Link from "next/link";
import clsx from "clsx";
import { Icon, type IconName } from "@/components/ui/icon";
import { arNum, arPercent, arRating } from "@/lib/format";
import { arDayMonth, arMonthLabel } from "@/lib/dates";
import { monthNames } from "@/lib/constants";
import type { Dictionary } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/config";
import type {
  Insight,
  ListingPerformance,
  MonthPoint,
  UpcomingStay,
} from "@/lib/owner-insights";

/**
 * The panels that make up the owner's performance view.
 *
 * All server components: every figure is computed in `getOwnerInsights` and
 * rendered here as HTML with no client-side charting library. That is a
 * deliberate choice, not a limitation — six bars and a progress track are a few
 * divs, and shipping a charting bundle to an owner checking their phone on
 * mobile data to buy that would be a poor trade.
 *
 * ─── Chart conventions ───────────────────────────────────────────────────────
 * • Every chart here plots ONE measure. Money and counts are never put on the
 *   same axis; the request count travels as text, not as a second scale.
 * • One hue for that measure, drawn from the accent the operator sets in
 *   /admin/settings, so a rebrand carries the charts with it.
 * • Values are not printed on every mark — only the peak is labelled. The rest
 *   are reachable on hover and, for anyone not using a mouse, through the
 *   `aria-label` on each bar, which reads the month, the amount and the count.
 * • Direction is never mirrored by hand. A flex row in an RTL document already
 *   starts at the right, so the oldest month sits where an Arabic reader begins
 *   and where an English reader begins, with the same markup.
 */

const CARD = "rounded-[20px] border border-line bg-surface p-4 shadow-e1";

/* -------------------------------------------------------------------------- */
/* Headline tiles                                                             */
/* -------------------------------------------------------------------------- */

export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  icon: IconName;
  tone?: "neutral" | "urgent" | "good";
}) {
  return (
    <div className={CARD}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-muted">{label}</span>
        <Icon
          name={icon}
          size={20}
          className={clsx(
            tone === "urgent" ? "text-busy" : tone === "good" ? "text-ok" : "text-gold-600",
          )}
        />
      </div>
      <div
        className={clsx(
          "font-display text-[26px] font-extrabold leading-none",
          tone === "urgent" ? "text-busy" : "text-ink",
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-[11.5px] text-muted">{sub}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Advice                                                                     */
/* -------------------------------------------------------------------------- */

const TONE_STYLES: Record<Insight["tone"], { box: string; icon: IconName; iconClass: string }> = {
  urgent: { box: "border-busy/30 bg-busy-bg", icon: "warning", iconClass: "text-busy" },
  opportunity: { box: "border-gold-300 bg-gold-100/60", icon: "bolt", iconClass: "text-bronze" },
  good: { box: "border-ok/30 bg-ok-bg", icon: "verified", iconClass: "text-ok" },
};

/** Turn one insight into the sentence its dictionary entry defines. */
function insightText(insight: Insight, t: Dictionary, locale: Locale): string {
  const count = arNum(insight.count ?? 0, locale);
  switch (insight.key) {
    case "unanswered":
      return t.owner.insightUnanswered(count);
    case "lowConfirmation":
      return t.owner.insightLowConfirmation(count);
    case "weekendDemand":
      return t.owner.insightWeekendDemand(count);
    case "quietListing":
      return t.owner.insightQuietListing(insight.value ?? "");
    case "fewPhotos":
      return t.owner.insightFewPhotos(insight.value ?? "");
    case "highOccupancy":
      return t.owner.insightHighOccupancy(count);
    case "noListings":
      return t.owner.insightNoListings;
  }
}

export function AdvicePanel({
  insights,
  t,
  locale,
}: {
  insights: Insight[];
  t: Dictionary;
  locale: Locale;
}) {
  if (insights.length === 0) return null;

  return (
    <div className={CARD}>
      <h2 className="m-0 mb-3 font-display text-[15.5px] font-extrabold text-ink">
        {t.owner.adviceTitle}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {insights.map((insight) => {
          const style = TONE_STYLES[insight.tone];
          return (
            <li
              key={insight.key}
              className={clsx(
                "flex items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-[13px] leading-[1.7] text-ink",
                style.box,
              )}
            >
              <Icon name={style.icon} size={19} className={clsx("mt-0.5 shrink-0", style.iconClass)} />
              <span>{insightText(insight, t, locale)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Monthly earnings                                                           */
/* -------------------------------------------------------------------------- */

export function EarningsTrend({
  trend,
  months,
  t,
  locale,
}: {
  trend: MonthPoint[];
  months: number;
  t: Dictionary;
  locale: Locale;
}) {
  const peak = Math.max(...trend.map((p) => p.earnings), 0);
  const hasAny = peak > 0;
  const names = monthNames(locale);

  return (
    <div className={CARD}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="m-0 font-display text-[15.5px] font-extrabold text-ink">
          {t.owner.trendTitle}
        </h2>
        <span className="text-[11px] text-muted">{t.common.aed}</span>
      </div>
      <p className="m-0 mb-4 text-[11.5px] text-muted">
        {t.owner.trendSub(arNum(months, locale))}
      </p>

      {!hasAny ? (
        <p className="m-0 py-6 text-center text-[13px] text-muted">{t.owner.trendEmpty}</p>
      ) : (
        <div className="flex h-[148px] items-stretch gap-1.5">
          {trend.map((point) => {
            // Share of the tallest month. The tallest bar fills the plot, so the
            // comparison a reader makes is between months — which is the only
            // comparison this chart is for.
            const share = peak > 0 ? (point.earnings / peak) * 100 : 0;
            const isPeak = point.earnings === peak && point.earnings > 0;

            return (
              <div key={point.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span className="h-3.5 text-[9.5px] font-bold text-bronze">
                  {isPeak ? arNum(point.earnings, locale) : ""}
                </span>

                {/* The track is the full plot height, so an empty month reads as
                    empty rather than as a very small value. */}
                <div
                  className="relative w-full flex-1 overflow-hidden rounded-[7px] bg-sand-100"
                  title={t.owner.trendMonthLabel(
                    arMonthLabel(point.year, point.month, locale),
                    arNum(point.earnings, locale),
                    arNum(point.confirmed, locale),
                  )}
                >
                  <div
                    role="img"
                    aria-label={t.owner.trendMonthLabel(
                      arMonthLabel(point.year, point.month, locale),
                      arNum(point.earnings, locale),
                      arNum(point.confirmed, locale),
                    )}
                    className="absolute inset-x-0 bottom-0 rounded-[7px] bg-gold-500"
                    style={{ height: `${share}%` }}
                  />
                </div>

                <span className="w-full truncate text-center text-[10px] text-muted">
                  {names[point.month]}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Occupancy                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One number with a track under it, not a donut.
 *
 * Occupancy is a single proportion. A donut spends a whole chart drawing one
 * value and makes the reader compare arc lengths to get it back; the number
 * itself, big, with a bar for the shape of it, is faster to read and smaller on
 * the page.
 */
export function OccupancyPanel({
  occupancyPct,
  bookedNights,
  capacityNights,
  aheadDays,
  publishedCount,
  t,
  locale,
}: {
  occupancyPct: number;
  bookedNights: number;
  capacityNights: number;
  aheadDays: number;
  publishedCount: number;
  t: Dictionary;
  locale: Locale;
}) {
  return (
    <div className={CARD}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="m-0 font-display text-[15.5px] font-extrabold text-ink">
          {t.owner.occupancyTitle}
        </h2>
        <Icon name="donut_large" size={20} className="text-gold-600" />
      </div>
      <p className="m-0 mb-4 text-[11.5px] text-muted">
        {t.owner.occupancySub(arNum(aheadDays, locale))}
      </p>

      {publishedCount === 0 ? (
        <p className="m-0 py-4 text-center text-[13px] text-muted">
          {t.owner.occupancyNoListings}
        </p>
      ) : (
        <>
          <div className="font-display text-[38px] font-extrabold leading-none text-ink">
            {arPercent(occupancyPct, locale)}
          </div>
          <div
            className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-sand-100"
            role="img"
            aria-label={t.owner.occupancyDetail(
              arNum(bookedNights, locale),
              arNum(capacityNights, locale),
            )}
          >
            <div
              className="h-full rounded-full bg-gold-500"
              style={{ width: `${Math.min(100, occupancyPct)}%` }}
            />
          </div>
          <p className="m-0 mt-2 text-[11.5px] text-muted">
            {t.owner.occupancyDetail(
              arNum(bookedNights, locale),
              arNum(capacityNights, locale),
            )}
          </p>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Booking patterns                                                           */
/* -------------------------------------------------------------------------- */

export function PatternsPanel({
  values,
  windowDays,
  t,
  locale,
}: {
  values: {
    confirmationRate: number | null;
    avgBookingValue: number | null;
    avgNights: number | null;
    avgLeadTimeDays: number | null;
    avgGuests: number | null;
    weekendSharePct: number | null;
    repeatGuests: number;
    requestsInWindow: number;
  };
  windowDays: number;
  t: Dictionary;
  locale: Locale;
}) {
  const dash = t.common.none;

  const rows: { label: string; sub?: string; value: string; icon: IconName }[] = [
    {
      label: t.owner.confirmationRate,
      sub: t.owner.confirmationRateSub,
      value:
        values.confirmationRate === null ? dash : arPercent(values.confirmationRate, locale),
      icon: "task_alt",
    },
    {
      label: t.owner.requestsInWindow,
      value: arNum(values.requestsInWindow, locale),
      icon: "inbox",
    },
    {
      label: t.owner.avgValue,
      value:
        values.avgBookingValue === null
          ? dash
          : `${arNum(values.avgBookingValue, locale)} ${t.common.aed}`,
      icon: "savings",
    },
    {
      label: t.owner.avgNightsLabel,
      // `arRating`, not `arNum`: this is the repo's one-decimal formatter, and
      // `arNum` is built with `maximumFractionDigits: 0`, so an average of 2.5
      // nights would render as "٣". A half-night is exactly the part of this
      // figure worth seeing.
      value: values.avgNights === null ? dash : arRating(values.avgNights, locale),
      icon: "event",
    },
    {
      label: t.owner.avgLeadTime,
      value:
        values.avgLeadTimeDays === null
          ? dash
          : t.owner.avgLeadTimeValue(arNum(values.avgLeadTimeDays, locale)),
      icon: "schedule",
    },
    {
      label: t.owner.avgGuestsLabel,
      value: values.avgGuests === null ? dash : arNum(values.avgGuests, locale),
      icon: "groups",
    },
    {
      label: t.owner.weekendShare,
      sub: t.owner.weekendShareSub,
      value:
        values.weekendSharePct === null ? dash : arPercent(values.weekendSharePct, locale),
      icon: "weekend",
    },
    {
      label: t.owner.repeatGuests,
      value: arNum(values.repeatGuests, locale),
      icon: "history",
    },
  ];

  return (
    <div className={CARD}>
      <h2 className="m-0 font-display text-[15.5px] font-extrabold text-ink">
        {t.owner.patternsTitle}
      </h2>
      <p className="m-0 mb-3.5 text-[11.5px] text-muted">
        {t.owner.patternsSub(arNum(windowDays, locale))}
      </p>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {rows.map((row) => (
          <div key={row.label} className="rounded-2xl border border-line bg-sand-50 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-muted">
              <Icon name={row.icon} size={16} className="text-gold-600" />
              <span className="truncate text-[11px] font-semibold">{row.label}</span>
            </div>
            <div className="font-display text-[17px] font-extrabold leading-none text-ink">
              {row.value}
            </div>
            {row.sub && <div className="mt-1 text-[10.5px] leading-snug text-muted">{row.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-listing performance                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A table on a wide screen and a stack of cards on a phone — the same numbers,
 * laid out for the device rather than a table squeezed into 320px and scrolled
 * sideways. Owners open this on a phone, which is why the card form is the one
 * that renders by default.
 */
export function ListingTable({
  rows,
  t,
  locale,
}: {
  rows: ListingPerformance[];
  t: Dictionary;
  locale: Locale;
}) {
  if (rows.length === 0) return null;

  const name = (row: ListingPerformance) =>
    locale === "en" && row.nameEn ? row.nameEn : row.name;

  return (
    <div className={CARD}>
      <h2 className="m-0 mb-3.5 font-display text-[15.5px] font-extrabold text-ink">
        {t.owner.listingsTableTitle}
      </h2>

      {/* ---- phones ---- */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {rows.map((row) => (
          <Link
            key={row.id}
            href={`/owner/listings/${row.id}`}
            className="block rounded-2xl border border-line bg-sand-50 p-3 no-underline hover:border-gold-500 hover:no-underline"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1 text-[13.5px] font-bold text-ink">
                {name(row)}
                {!row.published && (
                  <span className="ms-1.5 rounded-full bg-sand-200 px-2 py-0.5 text-[10px] font-bold text-muted">
                    {t.owner.hiddenListing}
                  </span>
                )}
              </span>
              <span className="shrink-0 font-display text-[14px] font-extrabold text-bronze">
                {arNum(row.earnings, locale)} {t.common.aed}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
              <span>
                {t.owner.colRequests}: {arNum(row.requests, locale)}
              </span>
              <span>
                {t.owner.colConfirmed}: {arNum(row.confirmed, locale)}
              </span>
              <span>
                {t.owner.colOccupancy}: {arPercent(row.occupancyPct, locale)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Icon name="star" size={13} className="text-gold-500" />
                {row.reviewsCount > 0 ? arRating(row.rating, locale) : t.owner.noReviewsYet}
              </span>
            </div>

            <OccupancyBar pct={row.occupancyPct} className="mt-2" />
          </Link>
        ))}
      </div>

      {/* ---- wide screens ---- */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-start text-[11.5px] font-bold text-muted">
              <th className="pb-2 text-start font-bold">{t.owner.colListing}</th>
              <th className="pb-2 text-start font-bold">{t.owner.colRequests}</th>
              <th className="pb-2 text-start font-bold">{t.owner.colConfirmed}</th>
              <th className="pb-2 text-start font-bold">{t.owner.colEarnings}</th>
              <th className="pb-2 text-start font-bold">{t.owner.colOccupancy}</th>
              <th className="pb-2 text-start font-bold">{t.owner.colRating}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="py-2.5 pe-3">
                  <Link
                    href={`/owner/listings/${row.id}`}
                    className="font-bold text-ink no-underline hover:text-bronze hover:no-underline"
                  >
                    {name(row)}
                  </Link>
                  {!row.published && (
                    <span className="ms-1.5 rounded-full bg-sand-200 px-2 py-0.5 text-[10px] font-bold text-muted">
                      {t.owner.hiddenListing}
                    </span>
                  )}
                  {row.requests === 0 && (
                    <div className="mt-0.5 text-[11px] text-muted">{t.owner.neverRequested}</div>
                  )}
                </td>
                <td className="py-2.5 pe-3 text-muted">{arNum(row.requests, locale)}</td>
                <td className="py-2.5 pe-3 text-muted">{arNum(row.confirmed, locale)}</td>
                <td className="py-2.5 pe-3 font-bold text-ink">
                  {arNum(row.earnings, locale)} {t.common.aed}
                </td>
                <td className="w-[130px] py-2.5 pe-3">
                  <div className="mb-1 text-[12px] font-semibold text-ink">
                    {arPercent(row.occupancyPct, locale)}
                  </div>
                  <OccupancyBar pct={row.occupancyPct} />
                </td>
                <td className="py-2.5">
                  {row.reviewsCount > 0 ? (
                    <span className="inline-flex items-center gap-1 font-bold text-ink">
                      <Icon name="star" size={14} className="text-gold-500" />
                      {arRating(row.rating, locale)}
                    </span>
                  ) : (
                    <span className="text-muted">{t.owner.noReviewsYet}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OccupancyBar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-sand-200", className)}>
      <div
        className="h-full rounded-full bg-gold-500"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Upcoming stays                                                             */
/* -------------------------------------------------------------------------- */

export function UpcomingPanel({
  stays,
  t,
  locale,
}: {
  stays: UpcomingStay[];
  t: Dictionary;
  locale: Locale;
}) {
  return (
    <div className={CARD}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="m-0 font-display text-[15.5px] font-extrabold text-ink">
          {t.owner.upcomingTitle}
        </h2>
        <Icon name="event_available" size={20} className="text-gold-600" />
      </div>
      <p className="m-0 mb-3.5 text-[11.5px] text-muted">{t.owner.upcomingSub}</p>

      {stays.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">{t.owner.upcomingEmpty}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {stays.map((stay) => (
            <li
              key={stay.id}
              className="flex items-center gap-3 rounded-2xl border border-line bg-sand-50 p-3"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold-100 text-center leading-none text-bronze">
                {/* The day, taken straight off the "YYYY-MM-DD" string rather
                    than by splitting a formatted label apart again. */}
                <span className="font-display text-[13px] font-extrabold">
                  {arNum(Number(stay.checkIn.slice(8, 10)), locale)}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold text-ink">
                  {stay.customerName}
                </span>
                <span className="block truncate text-[11.5px] text-muted">
                  {stay.listingName} · {t.owner.upcomingLine(
                    arNum(stay.guests, locale),
                    arNum(stay.nights, locale),
                  )}
                </span>
              </span>
              <span className="shrink-0 text-[12.5px] font-bold text-bronze">
                {arDayMonth(stay.checkIn, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
