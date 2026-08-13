import { AnalyticsDashboard } from "@/components/analytics/dashboard";
import { ListingPicker } from "@/components/analytics/listing-picker";
import { PeriodFilter } from "@/components/analytics/period-filter";
import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { getAnalytics, resolvePeriod } from "@/lib/analytics";

/**
 * The operator's copy of the owner's performance view.
 *
 * Every panel here is the identical component the owner sees at
 * /owner/insights — see src/components/analytics/dashboard.tsx. The only
 * differences are the scope (no `ownerId`, so the whole platform is in reach)
 * and the rest-house picker above it, which is what the operator asked for:
 * the same indicators, for whichever rest house they are being asked about.
 *
 * Rendering the same component rather than a matching one is the point. Two
 * pages built to agree drift within a release, and then an owner is reading one
 * occupancy figure while the operator on the phone to them reads another.
 */
export default async function AdminInsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();

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
    getAnalytics({ listingId: listingId || undefined }, period),
    prisma.listing.findMany({
      select: { id: true, name: true, nameEn: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
  ]);

  const carried: Record<string, string> = listingId ? { listing: listingId } : {};

  return (
    <div className="animate-fade-up flex flex-col gap-4">
      <div>
        <h1 className="m-0 mb-1 font-display text-[20px] font-extrabold text-ink">
          {t.analytics.title}
        </h1>
        <p className="m-0 text-[13px] text-muted">{t.analytics.adminSubtitle}</p>
      </div>

      <ListingPicker
        basePath="/admin/insights"
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
        basePath="/admin/insights"
        exportPath="/admin/insights/export"
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
        <AnalyticsDashboard
          data={data}
          listingHref={(row) => `/admin/listings/${row.id}`}
          t={t}
          locale={locale}
        />
      )}
    </div>
  );
}
