import {
  AlertsPanel,
  AnalyticsListingTable,
  DayOfWeekPanel,
  KpiGrid,
  OccupancyBreakdown,
  PricingPanel,
  RevenueTrend,
  SourcesPanel,
  StayTypePanel,
  TruncatedNote,
} from "./panels";
import type { Analytics, ListingRow } from "@/lib/analytics";
import type { Dictionary } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/config";

/**
 * The performance view, in two halves and one whole.
 *
 * The operator's page and the owner's pages render THESE, differing only in the
 * scope they resolved and where a rest-house row links to. That is what "the
 * same indicators, with a picker for which rest house" means in practice: not
 * two implementations built to match, but one mounted more than once — so a
 * change to a definition cannot land on one audience and miss the other.
 *
 * ─── Why it splits ───────────────────────────────────────────────────────────
 * The owner asked for the headline figures on the dashboard itself and the
 * detail on a page of its own, so the page does not become crowded. The
 * operator, who comes to this looking for one rest house's numbers on purpose,
 * wants the lot in one place. Two exports and a third that is both, rather than
 * a flag — each page then reads as a list of what is on it.
 */

/**
 * What an owner wants at a glance: how much, how full, what to do about it, and
 * the shape of it over time.
 */
export function AnalyticsHeadline({
  data,
  t,
  locale,
}: {
  data: Analytics;
  t: Dictionary;
  locale: Locale;
}) {
  return (
    <>
      {data.truncated && <TruncatedNote t={t} />}
      <KpiGrid kpis={data.kpis} prior={data.priorKpis} t={t} locale={locale} />
      <AlertsPanel alerts={data.alerts} t={t} locale={locale} />
      <RevenueTrend trend={data.trend} bucket={data.bucket} t={t} locale={locale} />
    </>
  );
}

/** The "why" behind the headline: the calendar, the week, the mix, the prices. */
export function AnalyticsBreakdowns({
  data,
  listingHref,
  t,
  locale,
}: {
  data: Analytics;
  /** Where a rest-house row links to, if anywhere. */
  listingHref?: (row: ListingRow) => string | null;
  t: Dictionary;
  locale: Locale;
}) {
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <OccupancyBreakdown values={data} t={t} locale={locale} />
        <DayOfWeekPanel rows={data.byDayOfWeek} t={t} locale={locale} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <StayTypePanel overnight={data.overnight} dayUse={data.dayUse} t={t} locale={locale} />
        <PricingPanel pricing={data.pricing} t={t} locale={locale} />
      </div>

      <SourcesPanel sources={data.sources} t={t} locale={locale} />

      <AnalyticsListingTable rows={data.listings} hrefFor={listingHref} t={t} locale={locale} />
    </>
  );
}

/**
 * Both halves, in reading order — the operator's view.
 *
 * Headline figures, then what the numbers are telling you to do about them,
 * then the trend they came from, then the breakdowns.
 */
export function AnalyticsDashboard({
  data,
  listingHref,
  t,
  locale,
}: {
  data: Analytics;
  listingHref?: (row: ListingRow) => string | null;
  t: Dictionary;
  locale: Locale;
}) {
  return (
    <div className="flex flex-col gap-4">
      <AnalyticsHeadline data={data} t={t} locale={locale} />
      <AnalyticsBreakdowns data={data} listingHref={listingHref} t={t} locale={locale} />
    </div>
  );
}
