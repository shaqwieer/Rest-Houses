import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AdvicePanel,
  EarningsTrend,
  ListingTable,
  OccupancyPanel,
  PatternsPanel,
  UpcomingPanel,
} from "@/components/owner/insight-panels";
import { ar } from "@/lib/i18n/ar";
import { en } from "@/lib/i18n/en";
import type { Insight, ListingPerformance, MonthPoint, UpcomingStay } from "@/lib/owner-insights";

/**
 * The owner dashboard's panels, rendered.
 *
 * ─── Why a string and not a browser ──────────────────────────────────────────
 * Same reasoning as tests/footer-location.test.tsx: these are server components
 * with no interactivity, so the questions worth asking — does a bar get a
 * height, does an empty month stay empty, does every number come out in the
 * reader's digits — are answered exactly by the markup. `renderToStaticMarkup`
 * runs the real components with no jsdom and nothing about them mocked.
 *
 * What this cannot answer is how it *looks* at 320px. That needs eyes on a
 * screen, and is noted as such rather than pretended at here.
 */

const trend: MonthPoint[] = [
  { key: "2026-03", year: 2026, month: 2, requests: 0, confirmed: 0, nights: 0, earnings: 0 },
  { key: "2026-04", year: 2026, month: 3, requests: 2, confirmed: 1, nights: 3, earnings: 3_000 },
  { key: "2026-05", year: 2026, month: 4, requests: 5, confirmed: 4, nights: 9, earnings: 12_000 },
];

const listings: ListingPerformance[] = [
  {
    id: "l1",
    name: "استراحة الرمال",
    nameEn: "Sands Rest House",
    published: true,
    imageCount: 6,
    rating: 4.9,
    reviewsCount: 12,
    pricePerNight: 1_800,
    weekendPrice: 2_200,
    requests: 9,
    confirmed: 6,
    earnings: 12_000,
    occupancyPct: 40,
    bookedNights: 12,
    lastRequestAt: "2026-05-01",
  },
  {
    id: "l2",
    name: "استراحة ليوا",
    nameEn: null,
    published: false,
    imageCount: 2,
    rating: 0,
    reviewsCount: 0,
    pricePerNight: 900,
    weekendPrice: 0,
    requests: 0,
    confirmed: 0,
    earnings: 0,
    occupancyPct: 0,
    bookedNights: 0,
    lastRequestAt: null,
  },
];

const upcoming: UpcomingStay[] = [
  {
    id: "b1",
    reference: "RQ-2431",
    listingName: "استراحة الرمال",
    customerName: "خالد المنصوري",
    customerPhone: "+971502148890",
    checkIn: "2026-08-23",
    checkOut: "2026-08-25",
    nights: 2,
    guests: 10,
    earnings: 3_600,
  },
];

describe("the earnings chart", () => {
  it("scales every bar against the tallest month", () => {
    const html = renderToStaticMarkup(
      <EarningsTrend trend={trend} months={3} t={ar} locale="ar" />,
    );

    // 12,000 is the peak, so it fills the plot; 3,000 is a quarter of it.
    expect(html).toContain("height:100%");
    expect(html).toContain("height:25%");
    // The empty month is drawn as an empty track, never as a token stub that
    // would read as a small non-zero value.
    expect(html).toContain("height:0%");
  });

  it("prints a value above the peak bar only", () => {
    const html = renderToStaticMarkup(
      <EarningsTrend trend={trend} months={3} t={ar} locale="ar" />,
    );

    // A number over every bar is noise; one over the tallest gives the reader
    // the scale and lets the other bars be read against it. The rest of the
    // values are still reachable — they live in each bar's title and aria-label,
    // which is why this looks at the label spans rather than the whole document.
    const labels = [...html.matchAll(/text-bronze">([^<]*)</g)].map((m) => m[1]);
    expect(labels).toHaveLength(trend.length);
    expect(labels.filter((l) => l !== "")).toEqual(["١٢٬٠٠٠"]);

    // …and the un-labelled month's amount is present in its hover text.
    expect(html).toContain("أبريل ٢٠٢٦: ٣٬٠٠٠");
  });

  it("gives every bar a text alternative naming the month and the amount", () => {
    const html = renderToStaticMarkup(
      <EarningsTrend trend={trend} months={3} t={ar} locale="ar" />,
    );
    // Identity is never carried by colour alone — see the note in the component.
    expect(html.match(/aria-label=/g)?.length).toBe(trend.length);
    expect(html).toContain("مايو");
  });

  it("says so plainly when there is nothing to plot", () => {
    const empty = trend.map((p) => ({ ...p, earnings: 0, confirmed: 0 }));
    const html = renderToStaticMarkup(
      <EarningsTrend trend={empty} months={3} t={ar} locale="ar" />,
    );
    expect(html).toContain(ar.owner.trendEmpty);
  });
});

describe("occupancy", () => {
  it("shows the percentage, the bar and the nights behind it", () => {
    const html = renderToStaticMarkup(
      <OccupancyPanel
        occupancyPct={40}
        bookedNights={12}
        capacityNights={30}
        aheadDays={30}
        publishedCount={1}
        t={ar}
        locale="ar"
      />,
    );
    expect(html).toContain("٤٠٪");
    expect(html).toContain("width:40%");
  });

  it("never draws a bar past the end of its track", () => {
    const html = renderToStaticMarkup(
      <OccupancyPanel
        occupancyPct={140}
        bookedNights={42}
        capacityNights={30}
        aheadDays={30}
        publishedCount={1}
        t={ar}
        locale="ar"
      />,
    );
    expect(html).toContain("width:100%");
    expect(html).not.toContain("width:140%");
  });

  it("asks the owner to publish something rather than showing 0%", () => {
    const html = renderToStaticMarkup(
      <OccupancyPanel
        occupancyPct={0}
        bookedNights={0}
        capacityNights={0}
        aheadDays={30}
        publishedCount={0}
        t={ar}
        locale="ar"
      />,
    );
    expect(html).toContain(ar.owner.occupancyNoListings);
  });
});

describe("booking patterns", () => {
  it("renders a dash for a figure there is no data for, not a zero", () => {
    const html = renderToStaticMarkup(
      <PatternsPanel
        values={{
          confirmationRate: null,
          avgBookingValue: null,
          avgNights: null,
          avgLeadTimeDays: null,
          avgGuests: null,
          weekendSharePct: null,
          repeatGuests: 0,
          requestsInWindow: 0,
        }}
        windowDays={180}
        t={ar}
        locale="ar"
      />,
    );
    // "0 AED average booking" would be a claim; "—" is the truth.
    expect(html).not.toContain("٠ د.إ");
    expect(html).toContain(ar.common.none);
  });

  it("renders real values when they exist", () => {
    const html = renderToStaticMarkup(
      <PatternsPanel
        values={{
          confirmationRate: 75,
          avgBookingValue: 3_600,
          avgNights: 2.5,
          avgLeadTimeDays: 12,
          avgGuests: 18,
          weekendSharePct: 60,
          repeatGuests: 3,
          requestsInWindow: 24,
        }}
        windowDays={180}
        t={ar}
        locale="ar"
      />,
    );
    expect(html).toContain("٧٥٪");
    expect(html).toContain("٣٬٦٠٠");

    // 2.5 nights, not "3". `arNum` rounds to whole numbers, so a half-night
    // average has to go through the one-decimal formatter or it silently
    // becomes a different number.
    expect(html).toContain("٢٫٥");
  });
});

describe("the per-listing table", () => {
  it("marks an unpublished rest house and one that has had no requests", () => {
    const html = renderToStaticMarkup(<ListingTable rows={listings} t={ar} locale="ar" />);
    expect(html).toContain(ar.owner.hiddenListing);
    expect(html).toContain(ar.owner.neverRequested);
    // A rest house with no reviews reads as new, not as zero stars.
    expect(html).toContain(ar.owner.noReviewsYet);
  });

  it("uses the English name on the English site and falls back when there is none", () => {
    const html = renderToStaticMarkup(<ListingTable rows={listings} t={en} locale="en" />);
    expect(html).toContain("Sands Rest House");
    // No English name stored — the Arabic one stands in rather than a blank.
    expect(html).toContain("استراحة ليوا");
  });
});

describe("advice", () => {
  it("renders each insight with its own wording", () => {
    const insights: Insight[] = [
      { key: "unanswered", tone: "urgent", count: 3 },
      { key: "fewPhotos", tone: "opportunity", value: "استراحة ليوا" },
      { key: "highOccupancy", tone: "good", count: 82 },
    ];
    const html = renderToStaticMarkup(
      <AdvicePanel insights={insights} t={ar} locale="ar" />,
    );
    expect(html).toContain("٣");
    expect(html).toContain("استراحة ليوا");
    expect(html).toContain("٨٢");
  });

  it("renders nothing at all when there is no advice to give", () => {
    const html = renderToStaticMarkup(<AdvicePanel insights={[]} t={ar} locale="ar" />);
    expect(html).toBe("");
  });
});

describe("upcoming stays", () => {
  it("lists a confirmed arrival with its guest and nights", () => {
    const html = renderToStaticMarkup(<UpcomingPanel stays={upcoming} t={ar} locale="ar" />);
    expect(html).toContain("خالد المنصوري");
    expect(html).toContain("٢٣ أغسطس");
  });

  it("says the calendar is clear rather than rendering an empty box", () => {
    const html = renderToStaticMarkup(<UpcomingPanel stays={[]} t={ar} locale="ar" />);
    expect(html).toContain(ar.owner.upcomingEmpty);
  });
});
