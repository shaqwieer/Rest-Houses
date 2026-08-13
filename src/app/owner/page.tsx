import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/badge";
import { AdvicePanel, UpcomingPanel } from "@/components/owner/insight-panels";
import { AnalyticsHeadline } from "@/components/analytics/dashboard";
import { PeriodFilter } from "@/components/analytics/period-filter";
import { prisma } from "@/lib/prisma";
import { getActiveOwnerSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { arNum } from "@/lib/format";
import { arDayMonth, arFullDate, todayISO } from "@/lib/dates";
import { getAnalytics, resolvePeriod } from "@/lib/analytics";
import { getOwnerInsights } from "@/lib/owner-insights";
import { bookingDisplayStatus } from "@/lib/constants";

/**
 * Owner overview — the dashboard, and the platform's answer to "how is my rest
 * house doing?".
 *
 * ─── What is on it, and why in this order ────────────────────────────────────
 *  1. Anything overdue. `AdvicePanel` renders nothing when there is nothing, so
 *     on a normal day this costs no space at all — and on the day a request has
 *     been sitting unanswered for more than a day, it is the first thing seen.
 *  2. The period control, then the eight headline figures the owner asked for,
 *     each against the same period a year or a week earlier.
 *  3. What the numbers suggest doing, then the trend behind them.
 *  4. The operational lists: what came in, who is arriving.
 *
 * Everything measured comes from `getAnalytics`, so there is exactly one
 * occupancy figure and one revenue figure on this page, both labelled with the
 * period they cover. The four tiles that used to sit at the top measured the
 * *next* thirty days while these measure a chosen past period; two occupancy
 * percentages on one screen, on different bases, is a page arguing with itself.
 *
 * ─── What `getOwnerInsights` is still here for ───────────────────────────────
 * The two forward-looking things analytics deliberately does not do: the advice
 * about the coming month, and the list of guests arriving in the next fortnight.
 * Both are about what happens next rather than what happened, and both say so.
 *
 * ─── Scoping ────────────────────────────────────────────────────────────────
 * Every figure is scoped by `ownerId` in the WHERE clause. An owner must never
 * see another owner's requests, earnings or occupancy, and scoping in SQL is
 * what guarantees that rather than filtering after the fact.
 */
export default async function OwnerOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // null while the owner is pending/rejected/suspended/expired — the layout
  // is rendering the status panel and discards this page's output.
  const session = await getActiveOwnerSession();
  if (!session) return null;
  const { owner } = session;
  const { t, locale } = await getI18n();

  const sp = await searchParams;
  const str = (value: unknown) => (typeof value === "string" ? value : undefined);
  const period = resolvePeriod({
    period: str(sp.period),
    from: str(sp.from),
    to: str(sp.to),
  });

  const today = todayISO();

  const [analytics, insights, recent] = await Promise.all([
    getAnalytics({ ownerId: owner.id }, period),
    getOwnerInsights(owner.id),
    prisma.bookingRequest.findMany({
      where: { listing: { ownerId: owner.id } },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { listing: { select: { name: true } } },
    }),
  ]);

  return (
    <div className="animate-fade-up flex flex-col gap-4">
      <div>
        <h1 className="m-0 mb-1 font-display text-[20px] font-extrabold text-ink">
          {t.owner.overview}
        </h1>
        <p className="m-0 text-[13.5px] text-muted">
          {arFullDate(today, locale)}
          {" · "}
          {insights.newRequests > 0
            ? t.admin.pendingRequestsLine(arNum(insights.newRequests, locale))
            : t.admin.noPendingRequests}
        </p>
      </div>

      {/* Renders nothing when there is nothing overdue — see the note above. */}
      <AdvicePanel insights={insights.insights} t={t} locale={locale} />

      <PeriodFilter
        basePath="/owner"
        exportPath="/owner/insights/export"
        period={period.period}
        range={period.range}
        previous={period.previous}
        t={t}
        locale={locale}
      />

      <AnalyticsHeadline data={analytics} t={t} locale={locale} />

      {/* Revenue is booking value, not takings — said once, here, rather than
          repeated on every card that shows money. */}
      <p className="m-0 -mt-1 text-[11px] text-muted">{t.owner.earningsNote}</p>

      {/* The way through to the rest of it: the occupancy breakdown, the days of
          the week, day-use against overnight, where the days came from and what
          they went for. Kept off this page so it stays readable at a glance,
          which is what an owner opens it for. */}
      <Link
        href="/owner/insights"
        className="flex items-center gap-3 rounded-[20px] border border-line bg-surface p-4 text-start no-underline shadow-e1 transition hover:border-gold-500 hover:no-underline"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold-100 text-bronze">
          <Icon name="donut_large" size={21} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-bold text-ink">
            {t.analytics.detailedLink}
          </span>
          <span className="block text-[11.5px] text-muted">{t.analytics.ownerSubtitle}</span>
        </span>
      </Link>

      {/* ---- recent requests ---- */}
      <div className="rounded-[20px] border border-line bg-surface p-4.5 shadow-e1">
        <div className="mb-3.5 flex items-center justify-between">
          <h2 className="m-0 font-display text-[15.5px] font-extrabold text-ink">
            {t.admin.latestRequests}
          </h2>
          <Link
            href="/owner/bookings"
            className="text-[12.5px] font-bold text-bronze no-underline hover:no-underline"
          >
            {t.common.viewAll}
          </Link>
        </div>

        {recent.length === 0 ? (
          <p className="m-0 text-[13px] text-muted">{t.admin.noRequestsYet}</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {recent.map((r) => (
              <Link
                key={r.id}
                href="/owner/bookings"
                className="flex items-center gap-3 rounded-2xl border border-line bg-sand-50 p-3 no-underline transition hover:border-gold-500 hover:no-underline"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sand-200 text-bronze">
                  <Icon name="person" size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold text-ink">{r.customerName}</span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {r.listing.name} · {arDayMonth(r.checkIn, locale)} ·{" "}
                    {arNum(r.nights, locale)} {t.common.night}
                  </span>
                </span>
                {/* The same derived label the bookings page shows, so one
                    booking is not "مؤكد" here and "مكتمل" one tap away. */}
                <StatusBadge status={bookingDisplayStatus(r.status, r.stage)} />
              </Link>
            ))}
          </div>
        )}
      </div>

      <UpcomingPanel stays={insights.upcoming} t={t} locale={locale} />

      <Link
        href="/owner/listings/new"
        className="flex items-center gap-3 rounded-[20px] bg-night-900 p-4 text-start text-sand-50 no-underline transition hover:bg-night-700 hover:no-underline"
      >
        <Icon name="add_home" size={23} className="text-gold-300" />
        <span className="text-[13.5px] font-bold">{t.owner.addListing}</span>
      </Link>

      {insights.listingCount === 0 && (
        <div className="rounded-[20px] border border-dashed border-sand-300 bg-surface p-5 text-center">
          <Icon name="holiday_village" size={40} className="mx-auto text-sand-400" />
          <h2 className="mt-3 mb-1.5 font-display text-[16px] font-bold text-ink">
            {t.owner.noListingsTitle}
          </h2>
          <p className="m-0 mb-3.5 text-[13.5px] text-muted">{t.owner.noListingsBody}</p>
        </div>
      )}
    </div>
  );
}
