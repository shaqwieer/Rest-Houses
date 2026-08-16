import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KpiGrid, RevenueTrend } from "@/components/analytics/panels";
import { ar } from "@/lib/i18n/ar";
import { arNum } from "@/lib/format";
import { arDayMonth } from "@/lib/dates";
import type { Kpis, TimePoint } from "@/lib/analytics";

/**
 * The performance panels, rendered — same reasoning as
 * tests/owner-insight-panels.test.tsx: server components with no interactivity,
 * so the markup answers the questions worth asking.
 *
 * These exist because this chart was simplified from three measures to one, and
 * the reason it carried three was that each one was on screen somewhere. What is
 * asserted here is that the simplification did not lose them: occupancy and the
 * booking count moved to the cards and to each bar's reading, and did not
 * quietly evaporate.
 */

/** Thirty days as the chart now buckets them: a short oldest week, then four. */
const trend: TimePoint[] = [
  { key: "2026-07-18", label: "", days: 2, revenue: 0, bookings: 0, occupancyPct: 0 },
  { key: "2026-07-20", label: "", days: 7, revenue: 1_500, bookings: 1, occupancyPct: 14 },
  { key: "2026-07-27", label: "", days: 7, revenue: 2_500, bookings: 3, occupancyPct: 43 },
  { key: "2026-08-03", label: "", days: 7, revenue: 1_400, bookings: 2, occupancyPct: 29 },
  { key: "2026-08-10", label: "", days: 7, revenue: 3_000, bookings: 4, occupancyPct: 71 },
];

const kpis: Kpis = {
  revenue: 8_400,
  netRevenue: 7_560,
  bookings: 10,
  occupancyPct: 65,
  avgBookingValue: 840,
  avgDailyRate: 430,
  bookedDays: 19,
  availableDays: 11,
  cancellationPct: 9,
};

describe("the revenue chart", () => {
  it("draws one bar per bucket and nothing else", () => {
    const html = renderToStaticMarkup(
      <RevenueTrend trend={trend} bucket="week" t={ar} locale="ar" />,
    );
    // One labelled mark per bucket. The occupancy track used to double this.
    expect(html.match(/aria-label=/g)?.length).toBe(trend.length);
    expect(html).not.toContain(ar.analytics.legendOccupancy);
  });

  it("still says each bucket's bookings and occupancy in its reading", () => {
    const html = renderToStaticMarkup(
      <RevenueTrend trend={trend} bucket="week" t={ar} locale="ar" />,
    );
    // The measures the chart stopped drawing are in the label a screen reader
    // and a hovering cursor get.
    expect(html).toContain(`${arNum(4, "ar")} حجز`);
    expect(html).toContain(`إشغال ${arNum(71, "ar")}٪`);
  });

  it("prints every bucket's value while there is room for it", () => {
    const html = renderToStaticMarkup(
      <RevenueTrend trend={trend} bucket="week" t={ar} locale="ar" />,
    );
    for (const point of trend.filter((p) => p.revenue > 0)) {
      expect(html).toContain(arNum(point.revenue, "ar"));
    }
  });

  it("labels a bucket with the days it actually covers", () => {
    const html = renderToStaticMarkup(
      <RevenueTrend trend={trend} bucket="week" t={ar} locale="ar" />,
    );
    // The oldest bucket is two days, not seven, and its reading says so rather
    // than leaving a short bar to look like a collapse.
    expect(html).toContain(
      ar.analytics.rangeLine(arDayMonth("2026-07-18", "ar"), arDayMonth("2026-07-19", "ar")),
    );
  });

  it("names a month rather than dating it, even when the range clips it", () => {
    // A monthly bucket is keyed by the 1st whether the range starts there or
    // not, so the span reading a week gets would call this "١ فبراير — ١١ فبراير"
    // for eleven days that are actually the END of February.
    const months: TimePoint[] = [
      { key: "2026-02-01", label: "", days: 11, revenue: 900, bookings: 1, occupancyPct: 9 },
      { key: "2026-03-01", label: "", days: 31, revenue: 4_000, bookings: 5, occupancyPct: 40 },
    ];
    const html = renderToStaticMarkup(
      <RevenueTrend trend={months} bucket="month" t={ar} locale="ar" />,
    );
    expect(html).toContain("فبراير ٢٠٢٦");
    expect(html).not.toContain(
      ar.analytics.rangeLine(arDayMonth("2026-02-01", "ar"), arDayMonth("2026-02-11", "ar")),
    );
  });

  it("says so when there is no revenue at all", () => {
    const empty = trend.map((point) => ({ ...point, revenue: 0 }));
    const html = renderToStaticMarkup(
      <RevenueTrend trend={empty} bucket="week" t={ar} locale="ar" />,
    );
    expect(html).toContain(ar.analytics.trendEmpty);
  });
});

describe("the headline cards", () => {
  it("keeps all eight figures, with three of them leading", () => {
    const html = renderToStaticMarkup(
      <KpiGrid kpis={kpis} prior={kpis} t={ar} locale="ar" />,
    );
    for (const label of [
      ar.analytics.revenue,
      ar.analytics.bookings,
      ar.analytics.occupancy,
      ar.analytics.netRevenue,
      ar.analytics.avgBookingValue,
      ar.analytics.avgDailyRate,
      ar.analytics.daysSplit,
      ar.analytics.cancellation,
    ]) {
      expect(html).toContain(label);
    }
  });
});
