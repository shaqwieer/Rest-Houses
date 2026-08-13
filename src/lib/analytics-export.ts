import type { Analytics } from "./analytics";
import { CALENDAR_PLATFORM_NAMES, dayNames } from "./constants";
import { arMonthLabel, parseISODate } from "./dates";
import { localized, type Locale } from "./i18n/config";
import type { Dictionary } from "./i18n";

/**
 * The dashboard, as a spreadsheet.
 *
 * ─── Why CSV and not a real .xlsx ────────────────────────────────────────────
 * A genuine xlsx is a zip of XML parts and needs a library; CSV is thirty lines
 * here, opens in Excel by double-click, and imports into Numbers, Sheets and
 * every accounting package the owner's bookkeeper might use. The three things
 * that usually make a CSV open badly in Excel are all handled below.
 *
 * ─── The three things ────────────────────────────────────────────────────────
 *  1. A UTF-8 BOM. Without it Excel on Windows decodes the file in the system
 *     codepage and every Arabic heading arrives as mojibake.
 *  2. A leading `sep=,` line. Excel picks its delimiter from the machine's
 *     regional settings, and on a good many of them that is a semicolon — the
 *     whole sheet then lands in column A. This line overrides it, and Excel
 *     consumes it rather than showing it.
 *  3. CRLF line endings, which is what Excel writes and what its importer is
 *     least surprised by.
 *
 * ─── Numbers stay in Latin digits ────────────────────────────────────────────
 * Every figure on screen renders through `arNum` as "١٬٨٠٠". Written into a
 * spreadsheet that is TEXT: it cannot be summed, sorted or charted, and the
 * export exists precisely so those things can be done. So the values here are
 * raw and only the headings are translated.
 */

/** Escapes one field. Quotes anything that could break a row. */
function cell(value: string | number): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function row(...values: (string | number)[]): string {
  return values.map(cell).join(",");
}

export function analyticsCsv(
  data: Analytics,
  t: Dictionary,
  locale: Locale,
  /** Which rest house the figures cover, for the header block. */
  scopeLabel: string,
): string {
  const days = dayNames(locale);
  const lines: string[] = [];

  /* ---- what this file is ------------------------------------------------- */
  lines.push(row(t.analytics.title, scopeLabel));
  lines.push(row(t.analytics.period, `${data.range.from} → ${data.range.lastDay}`));
  lines.push(
    row(t.analytics.previousPeriod, `${data.previous.from} → ${data.previous.lastDay}`),
  );
  lines.push("");

  /* ---- §1 headline figures ----------------------------------------------- */
  // Two value columns rather than one, so the reader can see the movement the
  // change indicators on screen are showing without recomputing it. The second
  // column holds the previous period's FIGURE, not the change between them —
  // hence `previousPeriod` and not the `vsPrevious` wording used on screen,
  // which would label a value as if it were a delta.
  lines.push(row(t.analytics.title, t.analytics.period, t.analytics.previousPeriod));
  const pair = (label: string, now: number | null, before: number | null) =>
    lines.push(row(label, now ?? "", before ?? ""));

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
  lines.push("");

  /* ---- §3 the series ------------------------------------------------------ */
  lines.push(
    row(
      t.analytics.trendTitle,
      t.analytics.legendRevenue,
      t.analytics.legendBookings,
      t.analytics.legendOccupancy,
    ),
  );
  for (const point of data.trend) {
    // The bucket's first day, as a plain ISO date: a spreadsheet can parse that
    // into a real date, which "١ أغسطس" is not.
    lines.push(
      row(
        data.bucket === "month"
          ? arMonthLabel(
              parseISODate(point.key).getUTCFullYear(),
              parseISODate(point.key).getUTCMonth(),
              "en",
            )
          : point.key,
        point.revenue,
        point.bookings,
        point.occupancyPct,
      ),
    );
  }
  lines.push("");

  /* ---- §5 days of the week ------------------------------------------------ */
  lines.push(
    row(
      t.analytics.dowTitle,
      t.analytics.legendOccupancy,
      t.analytics.legendRevenue,
      t.analytics.bookedDays,
      t.analytics.capacityDays,
    ),
  );
  for (const point of data.byDayOfWeek) {
    lines.push(
      row(days[point.day], point.occupancyPct, point.revenue, point.bookedDays, point.capacityDays),
    );
  }
  lines.push("");

  /* ---- §6 with and without an overnight stay ------------------------------ */
  lines.push(
    row(
      t.analytics.stayTypeTitle,
      t.analytics.bookings,
      t.analytics.colRevenue,
      t.analytics.avgBookingValue,
    ),
  );
  lines.push(
    row(
      t.analytics.overnight,
      data.overnight.bookings,
      data.overnight.revenue,
      data.overnight.avgValue ?? "",
    ),
  );
  lines.push(
    row(t.analytics.dayUse, data.dayUse.bookings, data.dayUse.revenue, data.dayUse.avgValue ?? ""),
  );
  lines.push("");

  /* ---- §7 sources --------------------------------------------------------- */
  lines.push(
    row(
      t.analytics.sourcesTitle,
      t.analytics.sourceDaysCol,
      t.analytics.sourceBookingsCol,
      t.analytics.sourceRevenueCol,
      // Its own column here rather than the "+N" suffix the screen uses: a
      // spreadsheet wants one number per cell so it can be summed.
      t.analytics.importedDaysCol,
    ),
  );
  for (const source of data.sources) {
    const name =
      source.key === "RIHLA"
        ? t.analytics.sourceRihla
        : source.key === "DIRECT"
          ? t.analytics.sourceDirect
          : CALENDAR_PLATFORM_NAMES[source.key] || t.calendar.platformOther;
    lines.push(
      row(
        name,
        source.days,
        source.bookings,
        // A channel with imported days and no recorded booking has no revenue
        // to state. Left as the word rather than a 0 that would sum into a
        // total and quietly claim the platform earned nothing.
        source.bookings > 0 ? source.revenue : t.analytics.revenueUnknown,
        source.unrecordedDays,
      ),
    );
  }
  lines.push("");

  /* ---- per rest house ----------------------------------------------------- */
  lines.push(
    row(
      t.analytics.colListing,
      t.analytics.colBookings,
      t.analytics.colRevenue,
      t.analytics.colOccupancy,
      t.analytics.bookedDays,
    ),
  );
  for (const listing of data.listings) {
    lines.push(
      row(
        localized(listing.name, listing.nameEn, locale),
        listing.bookings,
        listing.revenue,
        listing.occupancyPct,
        listing.bookedDays,
      ),
    );
  }

  return `﻿sep=,\r\n${lines.join("\r\n")}\r\n`;
}

/** `rihla-analytics-2026-08-01-2026-08-31.csv` */
export function analyticsFilename(data: Analytics): string {
  return `rihla-analytics-${data.range.from}-${data.range.lastDay}.csv`;
}

/** The response every export route returns, so the headers are written once. */
export function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A dashboard export is a snapshot of live figures; a cached copy served
      // tomorrow would be silently wrong.
      "Cache-Control": "no-store",
    },
  });
}
