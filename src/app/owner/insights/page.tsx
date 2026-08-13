import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { AnalyticsBreakdowns } from "@/components/analytics/dashboard";
import { TruncatedNote } from "@/components/analytics/panels";
import { ListingPicker } from "@/components/analytics/listing-picker";
import { PeriodFilter } from "@/components/analytics/period-filter";
import { prisma } from "@/lib/prisma";
import { getActiveOwnerSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { getAnalytics, resolvePeriod } from "@/lib/analytics";

/**
 * The owner's performance page.
 *
 * The overview at /owner answers "how am I doing?" in one screen; this answers
 * "why?" — the occupancy breakdown, the days of the week, day-use against
 * overnight, where the days came from, and what they actually went for. Split
 * in two because the overview has to stay readable at a glance, which is the
 * thing an owner opens it for.
 *
 * ─── Scoping ────────────────────────────────────────────────────────────────
 * `ownerId` goes into `getAnalytics` on every request and is ANDed with the
 * `?listing=` parameter rather than replaced by it, so a hand-edited id can
 * only ever narrow what this owner sees — never widen it. See the note at the
 * top of src/lib/analytics.ts.
 */
export default async function OwnerInsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // null while the owner is pending/rejected/suspended/expired — the layout is
  // rendering the status panel and discards this page's output.
  const session = await getActiveOwnerSession();
  if (!session) return null;

  const { t, locale } = await getI18n();
  const sp = await searchParams;
  const str = (value: unknown) => (typeof value === "string" ? value : undefined);

  const period = resolvePeriod({
    period: str(sp.period),
    from: str(sp.from),
    to: str(sp.to),
  });
  const listingId = str(sp.listing) || "";

  const [data, options] = await Promise.all([
    getAnalytics({ ownerId: session.owner.id, listingId: listingId || undefined }, period),
    prisma.listing.findMany({
      where: { ownerId: session.owner.id },
      select: { id: true, name: true, nameEn: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const carried: Record<string, string> = listingId ? { listing: listingId } : {};

  return (
    <div className="animate-fade-up flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* "Detailed", not just "Analytics": the headline figures now live on
              the overview, and a second page called the same thing would read
              as the same page. */}
          <h1 className="m-0 mb-1 font-display text-[20px] font-extrabold text-ink">
            {t.analytics.detailedLink}
          </h1>
          <p className="m-0 text-[13px] text-muted">{t.analytics.ownerSubtitle}</p>
        </div>
        <Link
          href="/owner"
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-[12.5px] font-bold text-ink no-underline transition hover:border-gold-500 hover:no-underline"
        >
          <Icon name="space_dashboard" size={16} className="text-bronze" />
          {t.analytics.backToDashboard}
        </Link>
      </div>

      <ListingPicker
        basePath="/owner/insights"
        options={options}
        selected={listingId}
        hidden={{
          period: period.period,
          ...(period.period === "custom"
            ? { from: period.range.from, to: period.range.lastDay }
            : {}),
        }}
        t={t}
        locale={locale}
      />

      <PeriodFilter
        basePath="/owner/insights"
        exportPath="/owner/insights/export"
        period={period.period}
        range={period.range}
        previous={period.previous}
        extra={carried}
        t={t}
        locale={locale}
      />

      {data.listingCount === 0 ? (
        <p className="m-0 rounded-[20px] border border-dashed border-sand-300 bg-surface p-5 text-center text-[13.5px] text-muted">
          {t.analytics.noListings}
        </p>
      ) : (
        <>
          {/* The headline half of this view lives on the overview, and with it
              the note that says a cap bit. Repeated here so a partial figure is
              never presented as a total, whichever page it is read on. */}
          {data.truncated && <TruncatedNote t={t} />}
          <AnalyticsBreakdowns
            data={data}
            listingHref={(row) => `/owner/listings/${row.id}`}
            t={t}
            locale={locale}
          />
        </>
      )}
    </div>
  );
}
