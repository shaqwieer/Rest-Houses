import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/auth";
import { hiddenByOwnerStateCount, ownerCounts } from "@/lib/admin-queries";
import { bookingFilterWhere } from "@/lib/booking-view";
import { bookingDisplayStatus } from "@/lib/constants";
import { getI18n } from "@/lib/i18n/server";
import { arNum, arPercent } from "@/lib/format";
import { addDays, arDayMonth, arFullDate, todayISO } from "@/lib/dates";
import type { Dictionary } from "@/lib/i18n";

/**
 * Dashboard overview.
 *
 * Answers the questions an operator opens the app to ask: what needs a reply,
 * who is waiting to be approved, what is confirmed, how full is the platform,
 * and what came in last. Everything is a real query.
 */
export default async function AdminOverviewPage() {
  const admin = await requireAdminPage();
  const { t, locale } = await getI18n();

  const today = todayISO();
  const monthAhead = addDays(today, 30);

  const [
    newCount,
    confirmedCount,
    listingCount,
    recent,
    occupancy,
    revenue,
    owners,
    hiddenCount,
    commissionToConfirm,
    pendingReviews,
  ] = await Promise.all([
    prisma.bookingRequest.count({ where: { status: "NEW" } }),
    // Confirmed and NOT yet finished, matching the "مؤكد" chip this tile links
    // to. Counting every confirmed booking here would have the tile say 11 and
    // the page it opens show 4, with no way to tell which number was wrong.
    // The completed ones have their own chip on that page.
    prisma.bookingRequest.count({ where: bookingFilterWhere("CONFIRMED") }),
    prisma.listing.count(),
    prisma.bookingRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { listing: { select: { name: true } } },
    }),
    // Occupancy = sold nights ÷ (listings × 30 nights) over the coming month.
    //
    // "Sold" counts a confirmed booking here AND a night imported from
    // Airbnb/Booking.com: both are nights the rest house cannot be let for, and
    // an owner who takes half their business on Airbnb would otherwise read
    // this figure as half-empty. Owner blocks stay out — a day closed for
    // maintenance is not demand.
    //
    // `distinct` and not `count`, because a row here is now a *reason* a day is
    // closed rather than the day itself: a night booked on this platform while
    // also appearing in an imported feed is two rows and one night, and
    // counting rows would push occupancy over 100%. See the note on
    // `Availability` in prisma/schema.prisma.
    Promise.all([
      prisma.availability
        .findMany({
          where: {
            status: { in: ["BOOKED", "EXTERNAL"] },
            date: { gte: today, lt: monthAhead },
          },
          select: { listingId: true, date: true },
          distinct: ["listingId", "date"],
        })
        .then((rows) => rows.length),
      prisma.listing.count({ where: { published: true } }),
    ]),
    // Confirmed revenue for stays starting in the next 30 days.
    prisma.bookingRequest.aggregate({
      where: { status: "CONFIRMED", checkIn: { gte: today, lt: monthAhead } },
      _sum: { total: true },
    }),
    ownerCounts(),
    hiddenByOwnerStateCount(),
    // Step 6, waiting on this desk: the owner says the transfer went out and
    // nobody has confirmed it arrived.
    prisma.bookingRequest.count({
      where: {
        status: "CONFIRMED",
        commissionSentAt: { not: null },
        commissionConfirmedAt: null,
      },
    }),
    prisma.review.count({ where: { status: "PENDING" } }),
  ]);

  const [bookedNights, publishedCount] = occupancy;
  const capacityNights = publishedCount * 30;
  const occupancyPct =
    capacityNights > 0 ? Math.round((bookedNights / capacityNights) * 100) : 0;

  const revenueTotal = revenue._sum.total ?? 0;

  // Weekly occupancy bars for the next four weeks.
  const weeks = await Promise.all(
    [0, 1, 2, 3].map(async (w) => {
      const from = addDays(today, w * 7);
      const to = addDays(today, (w + 1) * 7);
      // Same two rules as the headline figure above: imported nights count as
      // sold, and days are counted once however many sources closed them.
      const booked = (
        await prisma.availability.findMany({
          where: { status: { in: ["BOOKED", "EXTERNAL"] }, date: { gte: from, lt: to } },
          select: { listingId: true, date: true },
          distinct: ["listingId", "date"],
        })
      ).length;
      const total = publishedCount * 7;
      const pct = total > 0 ? Math.round((booked / total) * 100) : 0;
      return { label: t.admin.weekLabel(arNum(w + 1, locale)), pct };
    }),
  );

  const stats: {
    label: string;
    value: string;
    sub: string;
    icon: IconName;
    href?: string;
  }[] = [
    {
      label: t.admin.statNewRequests,
      value: arNum(newCount, locale),
      sub: t.admin.statNewRequestsSub,
      icon: "mark_email_unread",
      href: "/admin/requests?status=NEW",
    },
    {
      label: t.admin.statPendingOwners,
      value: arNum(owners.pending, locale),
      sub: t.admin.statPendingOwnersSub,
      icon: "badge",
      href: "/admin/owner-requests",
    },
    {
      label: t.admin.statOwners,
      value: arNum(owners.active, locale),
      sub: t.admin.statOwnersSub,
      icon: "group",
      href: "/admin/owners",
    },
    {
      label: t.admin.statConfirmed,
      value: arNum(confirmedCount, locale),
      sub: t.admin.statConfirmedSub,
      icon: "task_alt",
      href: "/admin/requests?status=CONFIRMED",
    },
    {
      label: t.admin.statOccupancy,
      value: arPercent(occupancyPct, locale),
      sub: t.admin.statOccupancySub,
      icon: "donut_large",
    },
    {
      label: t.admin.statRevenue,
      value: arNum(revenueTotal, locale),
      sub: t.admin.statRevenueSub,
      icon: "payments",
      href: "/admin/payments",
    },
    // The two things the workflow puts on the OPERATOR's desk. Both are the
    // last step of somebody else's work waiting on a decision here, so they
    // belong on the page the operator opens first — a commission transfer the
    // owner has declared and a review the guest has written are otherwise
    // invisible until someone thinks to go looking.
    {
      label: t.admin.statCommissionToConfirm,
      value: arNum(commissionToConfirm, locale),
      sub: t.admin.statCommissionToConfirmSub,
      icon: "receipt_long",
      href: "/admin/payments",
    },
    {
      label: t.admin.statReviewsToModerate,
      value: arNum(pendingReviews, locale),
      sub: t.admin.statReviewsToModerateSub,
      icon: "rate_review",
      href: "/admin/reviews",
    },
  ];

  return (
    <div className="animate-fade-up flex flex-col gap-4">
      <div>
        <h1 className="m-0 mb-1 font-display text-[20px] font-extrabold text-ink">
          {greetingFor(new Date(), t)}
          {admin.name ? `، ${admin.name}` : ""}
        </h1>
        <p className="m-0 text-[13.5px] text-muted">
          {arFullDate(today, locale)}
          {" · "}
          {newCount > 0
            ? t.admin.pendingRequestsLine(arNum(newCount, locale))
            : t.admin.noPendingRequests}
        </p>
      </div>

      {/* Two things an operator must not miss: owners waiting on a decision, and
          listings that are live-but-invisible because an owner lapsed. Both are
          money sitting still, and neither is visible anywhere else. */}
      {owners.pending > 0 && (
        <Link
          href="/admin/owner-requests"
          className="flex items-center gap-2 rounded-xl bg-gold-100 px-3.5 py-2.5 text-[12.5px] font-semibold text-bronze no-underline hover:no-underline"
        >
          <Icon name="badge" size={16} />
          {t.admin.ownerRequestsSubtitle(arNum(owners.pending, locale))}
        </Link>
      )}
      {hiddenCount > 0 && (
        <Link
          href="/admin/owners"
          className="flex items-center gap-2 rounded-xl bg-busy-bg px-3.5 py-2.5 text-[12.5px] font-semibold text-busy no-underline hover:no-underline"
        >
          <Icon name="visibility_off" size={16} />
          {t.admin.hiddenListingsNote(arNum(hiddenCount, locale))}
        </Link>
      )}

      {/* ---- stat tiles ---- */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        {stats.map((s) => {
          const body = (
            <>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-muted">{s.label}</span>
                <Icon name={s.icon} size={20} className="text-gold-600" />
              </div>
              <div className="font-display text-[26px] font-extrabold leading-none text-ink">
                {s.value}
              </div>
              <div className="mt-1 text-[11.5px] text-muted">{s.sub}</div>
            </>
          );
          const className =
            "rounded-[20px] border border-line bg-surface p-4 shadow-e1 no-underline transition hover:border-gold-500 hover:no-underline";
          return s.href ? (
            <Link key={s.label} href={s.href} className={className}>
              {body}
            </Link>
          ) : (
            <div key={s.label} className={className}>
              {body}
            </div>
          );
        })}
      </div>

      {/* ---- occupancy ---- */}
      <div className="rounded-[20px] border border-line bg-surface p-4.5 shadow-e1">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="m-0 font-display text-[15.5px] font-extrabold text-ink">
            {t.admin.weeklyOccupancy}
          </h2>
          <span className="text-[11.5px] text-muted">{t.admin.nextFourWeeks}</span>
        </div>

        {publishedCount === 0 ? (
          <p className="m-0 text-[13px] text-muted">{t.admin.addListingFirst}</p>
        ) : (
          <div className="flex h-30 items-end gap-2">
            {weeks.map((w) => (
              <div
                key={w.label}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
              >
                <span className="text-[11px] font-bold text-bronze">
                  {arPercent(w.pct, locale)}
                </span>
                <div
                  className="w-full rounded-t-[10px] rounded-b bg-gold-500 transition-all"
                  // A zero-height bar reads as a rendering bug; keep a 3% stub so
                  // an empty week is visibly empty rather than missing.
                  style={{
                    height: `${Math.max(3, w.pct)}%`,
                    background: w.pct >= 70 ? "var(--gold-500)" : "var(--sand-300)",
                  }}
                />
                <span className="text-[11px] text-muted">{w.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- recent requests ---- */}
      <div className="rounded-[20px] border border-line bg-surface p-4.5 shadow-e1">
        <div className="mb-3.5 flex items-center justify-between">
          <h2 className="m-0 font-display text-[15.5px] font-extrabold text-ink">
            {t.admin.latestRequests}
          </h2>
          <Link
            href="/admin/requests"
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
                href="/admin/requests"
                className="flex items-center gap-3 rounded-2xl border border-line bg-sand-50 p-3 no-underline transition hover:border-gold-500 hover:no-underline"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sand-200 text-bronze">
                  <Icon name="person" size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold text-ink">
                    {r.customerName}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {r.listing.name} · {arDayMonth(r.checkIn, locale)} ·{" "}
                    {arNum(r.nights, locale)} {t.common.night}
                  </span>
                </span>
                {/* The same derived label the requests page shows, so one
                    booking is not "مؤكد" here and "مكتمل" one tap away. */}
                <StatusBadge status={bookingDisplayStatus(r.status, r.stage)} />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ---- quick actions ---- */}
      <div className="grid grid-cols-2 gap-2.5">
        <Link
          href="/admin/listings/new"
          className="flex items-center gap-3 rounded-[20px] bg-night-900 p-4 text-start text-sand-50 no-underline transition hover:bg-night-700 hover:no-underline"
        >
          <Icon name="add_home" size={23} className="text-gold-300" />
          <span className="text-[13.5px] font-bold">{t.admin.quickAddListing}</span>
        </Link>
        <Link
          href="/admin/calendar"
          className="flex items-center gap-3 rounded-[20px] border border-line bg-surface p-4 text-start text-ink no-underline transition hover:border-gold-500 hover:no-underline"
        >
          <Icon name="event_busy" size={23} className="text-bronze" />
          <span className="text-[13.5px] font-bold">{t.admin.quickBlockDates}</span>
        </Link>
      </div>

      {listingCount === 0 && (
        <div className="rounded-[20px] border border-dashed border-sand-300 bg-surface p-5 text-center">
          <Icon name="holiday_village" size={40} className="mx-auto text-sand-400" />
          <h2 className="mt-3 mb-1.5 font-display text-[16px] font-bold text-ink">
            {t.owner.noListingsTitle}
          </h2>
          <p className="m-0 mb-3.5 text-[13.5px] text-muted">{t.admin.seedHint}</p>
          <Link
            href="/admin/listings/new"
            className="inline-flex items-center gap-2 rounded-full bg-linear-[140deg,var(--gold-500),var(--gold-600)] px-5 py-3 text-[14px] font-extrabold text-night-900 no-underline shadow-gold hover:no-underline"
          >
            <Icon name="add" size={18} />
            {t.admin.quickAddListing}
          </Link>
        </div>
      )}
    </div>
  );
}

/** Greeting by hour, in Gulf time. */
function greetingFor(now: Date, t: Dictionary): string {
  const gulfHour = new Date(now.getTime() + 4 * 3600_000).getUTCHours();
  if (gulfHour < 5) return t.admin.greetingNight;
  if (gulfHour < 12) return t.admin.greetingMorning;
  if (gulfHour < 17) return t.admin.greetingAfternoon;
  return t.admin.greetingEvening;
}
