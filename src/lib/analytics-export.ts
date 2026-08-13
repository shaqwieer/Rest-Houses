import type { Analytics } from "./analytics";
import { CALENDAR_PLATFORM_NAMES, dayNames } from "./constants";
import { localized, type Locale } from "./i18n/config";
import type { Dictionary } from "./i18n";
import { buildXlsx, date, head, maybeNum, num, text, type Row } from "./xlsx";

/**
 * The dashboard, as a spreadsheet.
 *
 * ─── Why .xlsx and not a CSV ─────────────────────────────────────────────────
 * This started as a CSV, which is thirty lines and opens everywhere. It came
 * back from a phone with every Arabic heading rendered as "Ø§Ù„ØªØ­Ù„ÙŠÙ„Ø§Øª".
 * A CSV carries no statement of its own encoding, so each reader guesses, and
 * the two hints that are supposed to steer Excel cancel each other out — see
 * the header of `xlsx.ts` for the detail. An .xlsx says what it is, so there is
 * nothing left to guess wrong.
 *
 * ─── Numbers stay in Latin digits ────────────────────────────────────────────
 * Every figure on screen renders through `arNum` as "١٬٨٠٠". Written into a
 * spreadsheet that is TEXT: it cannot be summed, sorted or charted, and the
 * export exists precisely so those things can be done. So the values here are
 * real numeric cells and only the headings are translated. Dates are real dates
 * for the same reason — a trend cannot be plotted against a column of strings.
 */

/** Column A carries Arabic labels and rest house names; the rest carry figures. */
const WIDTHS = [34, 18, 18, 18, 18];

export function analyticsWorkbook(
  data: Analytics,
  t: Dictionary,
  locale: Locale,
  /** Which rest house the figures cover, for the header block. */
  scopeLabel: string,
): Buffer {
  const days = dayNames(locale);
  const rows: Row[] = [];

  /* ---- what this file is ------------------------------------------------- */
  rows.push([head(t.analytics.title), text(scopeLabel)]);
  rows.push([text(t.analytics.period), date(data.range.from), date(data.range.lastDay)]);
  rows.push([
    text(t.analytics.previousPeriod),
    date(data.previous.from),
    date(data.previous.lastDay),
  ]);
  rows.push([]);

  /* ---- §1 headline figures ----------------------------------------------- */
  // Two value columns rather than one, so the reader can see the movement the
  // change indicators on screen are showing without recomputing it. The second
  // column holds the previous period's FIGURE, not the change between them —
  // hence `previousPeriod` and not the `vsPrevious` wording used on screen,
  // which would label a value as if it were a delta.
  rows.push([head(t.analytics.title), head(t.analytics.period), head(t.analytics.previousPeriod)]);
  const pair = (label: string, now: number | null, before: number | null) =>
    rows.push([text(label), maybeNum(now), maybeNum(before)]);

  pair(t.analytics.revenue, data.kpis.revenue, data.priorKpis.revenue);
  pair(t.analytics.netRevenue, data.kpis.netRevenue, data.priorKpis.netRevenue);
  pair(t.analytics.bookings, data.kpis.bookings, data.priorKpis.bookings);
  pair(t.analytics.occupancy, data.kpis.occupancyPct, data.priorKpis.occupancyPct);
  pair(t.analytics.avgBookingValue, data.kpis.avgBookingValue, data.priorKpis.avgBookingValue);
  pair(t.analytics.avgDailyRate, data.kpis.avgDailyRate, data.priorKpis.avgDailyRate);
  pair(t.analytics.bookedDays, data.kpis.bookedDays, data.priorKpis.bookedDays);
  pair(t.analytics.availableDays, data.kpis.availableDays, data.priorKpis.availableDays);
  pair(t.analytics.blockedDays, data.blockedDays, null);
  pair(t.analytics.capacityDays, data.capacityDays, null);
  pair(t.analytics.cancellation, data.kpis.cancellationPct, data.priorKpis.cancellationPct);
  pair(t.analytics.weekdayOccupancy, data.weekdayOccupancyPct, null);
  pair(t.analytics.weekendOccupancy, data.weekendOccupancyPct, null);
  pair(t.analytics.weekdayRate, data.pricing.weekdayRate, null);
  pair(t.analytics.weekendRate, data.pricing.weekendRate, null);
  rows.push([]);

  /* ---- §3 the series ------------------------------------------------------ */
  rows.push([
    head(t.analytics.trendTitle),
    head(t.analytics.legendRevenue),
    head(t.analytics.legendBookings),
    head(t.analytics.legendOccupancy),
  ]);
  for (const point of data.trend) {
    rows.push([
      // The bucket's first day as a real date, so the series can be charted
      // against time. A monthly bucket is shown as "Aug 2026" rather than the
      // 1st of the month, which is the same value read more honestly.
      date(point.key, data.bucket === "month"),
      num(point.revenue),
      num(point.bookings),
      num(point.occupancyPct),
    ]);
  }
  rows.push([]);

  /* ---- §5 days of the week ------------------------------------------------ */
  rows.push([
    head(t.analytics.dowTitle),
    head(t.analytics.legendOccupancy),
    head(t.analytics.legendRevenue),
    head(t.analytics.bookedDays),
    head(t.analytics.capacityDays),
  ]);
  for (const point of data.byDayOfWeek) {
    rows.push([
      text(days[point.day]),
      num(point.occupancyPct),
      num(point.revenue),
      num(point.bookedDays),
      num(point.capacityDays),
    ]);
  }
  rows.push([]);

  /* ---- §6 with and without an overnight stay ------------------------------ */
  rows.push([
    head(t.analytics.stayTypeTitle),
    head(t.analytics.bookings),
    head(t.analytics.colRevenue),
    head(t.analytics.avgBookingValue),
  ]);
  rows.push([
    text(t.analytics.overnight),
    num(data.overnight.bookings),
    num(data.overnight.revenue),
    maybeNum(data.overnight.avgValue),
  ]);
  rows.push([
    text(t.analytics.dayUse),
    num(data.dayUse.bookings),
    num(data.dayUse.revenue),
    maybeNum(data.dayUse.avgValue),
  ]);
  rows.push([]);

  /* ---- §7 sources --------------------------------------------------------- */
  rows.push([
    head(t.analytics.sourcesTitle),
    head(t.analytics.sourceDaysCol),
    head(t.analytics.sourceBookingsCol),
    head(t.analytics.sourceRevenueCol),
    // Its own column here rather than the "+N" suffix the screen uses: a
    // spreadsheet wants one number per cell so it can be summed.
    head(t.analytics.importedDaysCol),
  ]);
  for (const source of data.sources) {
    const name =
      source.key === "RIHLA"
        ? t.analytics.sourceRihla
        : source.key === "DIRECT"
          ? t.analytics.sourceDirect
          : CALENDAR_PLATFORM_NAMES[source.key] || t.calendar.platformOther;
    rows.push([
      text(name),
      num(source.days),
      num(source.bookings),
      // A channel with imported days and no recorded booking has no revenue
      // to state. Left as the word rather than a 0 that would sum into a
      // total and quietly claim the platform earned nothing.
      source.bookings > 0 ? num(source.revenue) : text(t.analytics.revenueUnknown),
      num(source.unrecordedDays),
    ]);
  }
  rows.push([]);

  /* ---- per rest house ----------------------------------------------------- */
  rows.push([
    head(t.analytics.colListing),
    head(t.analytics.colBookings),
    head(t.analytics.colRevenue),
    head(t.analytics.colOccupancy),
    head(t.analytics.bookedDays),
  ]);
  for (const listing of data.listings) {
    rows.push([
      text(localized(listing.name, listing.nameEn, locale)),
      num(listing.bookings),
      num(listing.revenue),
      num(listing.occupancyPct),
      num(listing.bookedDays),
    ]);
  }

  return buildXlsx({
    name: t.analytics.title,
    rows,
    widths: WIDTHS,
    // Arabic reads right to left, and so should the sheet — column A on the
    // right, where the labels belong.
    rightToLeft: locale === "ar",
  });
}

/** `rihla-analytics-2026-08-01-2026-08-31.xlsx` */
export function analyticsFilename(data: Analytics): string {
  return `rihla-analytics-${data.range.from}-${data.range.lastDay}.xlsx`;
}

/** The response every export route returns, so the headers are written once. */
export function workbookResponse(body: Buffer, filename: string): Response {
  // Copied into a plain Uint8Array rather than handed over as a Buffer: a small
  // Buffer is a window onto a shared pool, and a runtime that reaches for its
  // backing `.buffer` would send the neighbouring allocations along with it.
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // No hand-written Content-Length. `Response` derives it, and a stale one
      // survives into a proxy that re-encodes the body and truncates the file.
      // A dashboard export is a snapshot of live figures; a cached copy served
      // tomorrow would be silently wrong.
      "Cache-Control": "no-store",
    },
  });
}
