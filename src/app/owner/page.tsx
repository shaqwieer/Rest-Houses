import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/badge";
import {
  AdvicePanel,
  EarningsTrend,
  ListingTable,
  OccupancyPanel,
  PatternsPanel,
  StatTile,
  UpcomingPanel,
} from "@/components/owner/insight-panels";
import { prisma } from "@/lib/prisma";
import { getActiveOwnerSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { arNum, arPercent } from "@/lib/format";
import { arDayMonth, arFullDate, todayISO } from "@/lib/dates";
import {
  OWNER_INSIGHT_AHEAD_DAYS,
  OWNER_INSIGHT_WINDOW_DAYS,
  getOwnerInsights,
} from "@/lib/owner-insights";
import { bookingDisplayStatus } from "@/lib/constants";

/**
 * Owner overview — the dashboard, and the platform's answer to "how is my rest
 * house doing?".
 *
 * ─── Scoping ────────────────────────────────────────────────────────────────
 * Every figure on this page comes from `getOwnerInsights(owner.id)`, which
 * scopes each query by `ownerId` in the WHERE clause. An owner must never see
 * another owner's requests, earnings or occupancy, and scoping in SQL is what
 * guarantees that rather than filtering after the fact.
 *
 * ─── Why the analytics live on the overview and not behind a tab ────────────
 * The bottom tab bar is already four items wide on a phone, and a fifth would
 * squeeze every label. More to the point, an owner opening the dashboard is
 * asking exactly the question this page now answers, so hiding it one tap deeper
 * would mean most owners never saw it. The page is ordered by urgency instead:
 * what needs a reply today, then the advice, then the trend, then the detail.
 */
export default async function OwnerOverviewPage() {
  // null while the owner is pending/rejected/suspended/expired — the layout
  // is rendering the status panel and discards this page's output.
  const session = await getActiveOwnerSession();
  if (!session) return null;
  const { owner } = session;
  const { t, locale } = await getI18n();

  const today = todayISO();

  const [insights, recent] = await Promise.all([
    getOwnerInsights(owner.id),
    prisma.bookingRequest.findMany({
      where: { listing: { ownerId: owner.id } },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { listing: { select: { name: true } } },
    }),
  ]);

  const stats: {
    label: string;
    value: string;
    sub: string;
    icon: IconName;
    tone?: "neutral" | "urgent" | "good";
  }[] = [
    {
      label: t.admin.statNewRequests,
      value: arNum(insights.newRequests, locale),
      sub: t.admin.statNewRequestsSub,
      icon: "mark_email_unread",
    },
    // Swapped in only when something is actually overdue: a tile permanently
    // reading "0 waiting" is a tile an owner stops seeing, and the whole point of
    // this one is that it catches the eye on the day it matters.
    insights.unanswered > 0
      ? {
          label: t.owner.unansweredStat,
          value: arNum(insights.unanswered, locale),
          sub: t.owner.unansweredStatSub,
          icon: "warning",
          tone: "urgent" as const,
        }
      : {
          label: t.admin.statConfirmed,
          value: arNum(insights.confirmedAhead, locale),
          sub: t.admin.statConfirmedSub,
          icon: "task_alt",
        },
    {
      label: t.admin.statOccupancy,
      value: arPercent(insights.occupancyPct, locale),
      sub: t.owner.occupancySub(arNum(OWNER_INSIGHT_AHEAD_DAYS, locale)),
      icon: "donut_large",
    },
    {
      label: t.owner.earningsAhead,
      value: arNum(insights.earningsAhead, locale),
      sub: t.owner.earningsAheadSub,
      icon: "payments",
    },
  ];

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

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {stats.map((s) => (
          <StatTile key={s.label} {...s} />
        ))}
      </div>

      {/* Earnings are booking value, not takings — said once, here, rather than
          repeated on every tile that shows money. */}
      <p className="m-0 -mt-1 text-[11px] text-muted">{t.owner.earningsNote}</p>

      <AdvicePanel insights={insights.insights} t={t} locale={locale} />

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

      {/* ---- performance ---- */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <EarningsTrend trend={insights.trend} months={insights.trend.length} t={t} locale={locale} />
        <OccupancyPanel
          occupancyPct={insights.occupancyPct}
          bookedNights={insights.bookedNightsAhead}
          capacityNights={insights.capacityNightsAhead}
          aheadDays={OWNER_INSIGHT_AHEAD_DAYS}
          publishedCount={insights.publishedCount}
          t={t}
          locale={locale}
        />
      </div>

      <PatternsPanel
        values={insights}
        windowDays={OWNER_INSIGHT_WINDOW_DAYS}
        t={t}
        locale={locale}
      />

      <ListingTable rows={insights.listings} t={t} locale={locale} />

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
