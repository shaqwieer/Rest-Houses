import Link from "next/link";
import clsx from "clsx";
import { Icon, type IconName } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/auth";
import { hiddenByOwnerStateCount, monthPerformance, ownerCounts } from "@/lib/admin-queries";
import { bookingFilterWhere } from "@/lib/booking-view";
import { bookingDisplayStatus } from "@/lib/constants";
import { getI18n } from "@/lib/i18n/server";
import { localized } from "@/lib/i18n/config";
import { arDelta, arDeltaPercent, arNum, arPercent } from "@/lib/format";
import { arDayMonth, arFullDate, arMonthLabel, monthRange, todayISO } from "@/lib/dates";
import type { TopListing } from "@/lib/admin-queries";
import type { Dictionary } from "@/lib/i18n";

/**
 * Dashboard overview.
 *
 * ─── The tile order is a specification, not a layout choice ──────────────────
 * The operator wrote the seventeen figures out in the order they wanted to read
 * them, and asked for one continuous sequence with everything awaiting a
 * decision at the top. So `TILES` below is that list, in that order, and it
 * reads as the numbered list it came from:
 *
 *    1–4   waiting on this desk — and only these carry the indicator dot,
 *          which disappears entirely at zero. A dot that is always lit is a dot
 *          nobody looks at, which is the whole reason it is conditional.
 *    5–8   how big the platform is: owners, rest houses, confirmed bookings,
 *          reviews.
 *    9     of those confirmed bookings, the ones still being worked.
 *    10–13 this calendar month and the next: how full, and what it is worth.
 *    14–15 next month against this one.
 *    16–17 which rest house is carrying the month.
 *
 * Renumbering means moving an entry in that array and nothing else.
 *
 * ─── Why every month here is a CALENDAR month ────────────────────────────────
 * The operator asked for 1/8–31/8 and 1/9–30/9 explicitly, and they were right
 * to: a rolling thirty-day window starting on the 12th compares two arbitrary
 * stretches and gets the denominator wrong as well, since August has 31 nights
 * to sell and September 30. `monthRange` supplies both boundaries and the day
 * count; `monthPerformance` does the counting. Neither is fooled by an operator
 * opening the page on the 31st.
 *
 * The weekly-occupancy chart that used to sit under these tiles is gone. It
 * measured the next four weeks from today, which after this change would put a
 * second, differently-based occupancy figure on the same screen as tiles 10–13
 * — the page disagreeing with itself, which is the one thing a dashboard cannot
 * do and stay trusted.
 */

/** What one tile needs to render. */
type Tile = {
  label: string;
  value: string;
  sub: string;
  icon: IconName;
  href?: string;
  /**
   * True on the four tiles that represent work waiting on this desk. The dot is
   * drawn only when the figure is also non-zero — see the note above.
   */
  attention?: boolean;
  /** Colours a period-over-period change. */
  tone?: "up" | "down";
  /**
   * The value is a rest house name rather than a figure, so it is set smaller
   * and allowed to wrap instead of being clipped at the tile's edge.
   */
  isName?: boolean;
};

export default async function AdminOverviewPage() {
  const admin = await requireAdminPage();
  const { t, locale } = await getI18n();

  const today = todayISO();
  const thisMonth = monthRange(today);
  const nextMonth = monthRange(today, 1);

  const [
    newCount,
    owners,
    commissionToConfirm,
    pendingReviews,
    listingCount,
    publishedCount,
    confirmedAll,
    reviewCount,
    confirmedActive,
    recent,
    hiddenCount,
  ] = await Promise.all([
    prisma.bookingRequest.count({ where: { status: "NEW" } }),
    ownerCounts(),
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
    prisma.listing.count(),
    prisma.listing.count({ where: { published: true } }),
    // Tile 7: every confirmed booking, whatever stage it has reached — the ones
    // still being worked AND the ones finished. Tile 9 below is the subset that
    // still needs somebody, and the two are deliberately different queries.
    prisma.bookingRequest.count({ where: { status: "CONFIRMED" } }),
    // What a visitor can actually read. `published` is the column every public
    // query filters on, so this tile and the catalogue agree.
    prisma.review.count({ where: { published: true } }),
    // The same predicate as the "مؤكد" chip this tile links to, so the figure
    // here and the number of rows on the page it opens are the same figure.
    prisma.bookingRequest.count({ where: bookingFilterWhere("CONFIRMED") }),
    prisma.bookingRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { listing: { select: { name: true } } },
    }),
    hiddenByOwnerStateCount(),
  ]);

  // Sequential rather than inside the Promise.all above: both need
  // `publishedCount` for their denominator, and computing occupancy against a
  // capacity read in a different transaction is how the two silently disagree.
  const [current, ahead] = await Promise.all([
    monthPerformance(thisMonth, publishedCount),
    monthPerformance(nextMonth, publishedCount),
  ]);

  const thisMonthLabel = arMonthLabel(thisMonth.year, thisMonth.month, locale);
  const nextMonthLabel = arMonthLabel(nextMonth.year, nextMonth.month, locale);

  // Occupancy is compared in POINTS. Both figures are already percentages, and
  // the ratio of two percentages ("occupancy rose 40%") is a sentence nobody
  // can act on — the gap between them is the thing an operator reads.
  const occupancyPoints = ahead.occupancyPct - current.occupancyPct;

  // Revenue is compared RELATIVELY, which needs a non-zero base. A month with
  // no confirmed bookings yet has no percentage to be up from, so the tile says
  // so rather than rendering an Infinity.
  const revenueChange =
    current.revenue > 0
      ? Math.round(((ahead.revenue - current.revenue) / current.revenue) * 100)
      : null;

  const listingName = (top: TopListing) => localized(top.name, top.nameEn, locale);

  const tiles: Tile[] = [
    /* ---- 1–4 · waiting on this desk ------------------------------------- */
    {
      label: t.admin.statNewRequests,
      value: arNum(newCount, locale),
      sub: t.admin.statNewRequestsSub,
      icon: "mark_email_unread",
      href: "/admin/requests?status=NEW",
      attention: newCount > 0,
    },
    {
      label: t.admin.statPendingOwners,
      value: arNum(owners.pending, locale),
      sub: t.admin.statPendingOwnersSub,
      icon: "badge",
      href: "/admin/owner-requests",
      attention: owners.pending > 0,
    },
    {
      label: t.admin.statCommissionToConfirm,
      value: arNum(commissionToConfirm, locale),
      sub: t.admin.statCommissionToConfirmSub,
      icon: "receipt_long",
      href: "/admin/payments",
      attention: commissionToConfirm > 0,
    },
    {
      label: t.admin.statReviewsToModerate,
      value: arNum(pendingReviews, locale),
      sub: t.admin.statReviewsToModerateSub,
      icon: "rate_review",
      href: "/admin/reviews",
      attention: pendingReviews > 0,
    },

    /* ---- 5–8 · the size of the platform --------------------------------- */
    {
      label: t.admin.statOwners,
      value: arNum(owners.active, locale),
      sub: t.admin.statOwnersSub,
      icon: "group",
      href: "/admin/owners",
    },
    {
      label: t.admin.statListings,
      value: arNum(listingCount, locale),
      sub: t.admin.statListingsSub(arNum(publishedCount, locale)),
      icon: "holiday_village",
      href: "/admin/listings",
    },
    {
      // No link, deliberately. This counts two filter chips at once and the
      // requests page has no view that shows exactly this number — a tile
      // reading 11 that opens a list of 4 is worse than one that does not open.
      label: t.admin.statConfirmedAll,
      value: arNum(confirmedAll, locale),
      sub: t.admin.statConfirmedAllSub,
      icon: "task_alt",
    },
    {
      label: t.admin.statReviews,
      value: arNum(reviewCount, locale),
      sub: t.admin.statReviewsSub,
      icon: "star",
      href: "/admin/reviews",
    },

    /* ---- 9 · still being worked ----------------------------------------- */
    {
      label: t.admin.statConfirmed,
      value: arNum(confirmedActive, locale),
      sub: t.admin.statConfirmedSub,
      icon: "schedule",
      href: "/admin/requests?status=CONFIRMED",
    },

    /* ---- 10–13 · this month and the next -------------------------------- */
    {
      label: t.admin.statOccupancyThisMonth,
      value: arPercent(current.occupancyPct, locale),
      sub: t.admin.statWholeMonth(thisMonthLabel),
      icon: "donut_large",
    },
    {
      label: t.admin.statRevenueThisMonth,
      value: arNum(current.revenue, locale),
      sub: t.admin.statRevenueMonthSub(thisMonthLabel),
      icon: "payments",
      href: "/admin/payments",
    },
    {
      label: t.admin.statOccupancyNextMonth,
      value: arPercent(ahead.occupancyPct, locale),
      sub: t.admin.statWholeMonth(nextMonthLabel),
      icon: "donut_large",
    },
    {
      label: t.admin.statRevenueNextMonth,
      value: arNum(ahead.revenue, locale),
      sub: t.admin.statRevenueMonthSub(nextMonthLabel),
      icon: "payments",
      href: "/admin/payments",
    },

    /* ---- 14–15 · next month against this one ---------------------------- */
    {
      label: t.admin.statOccupancyChange,
      value: arDelta(occupancyPoints, locale),
      sub: t.admin.statOccupancyChangeSub,
      // `swap_vert` rather than a directional arrow: the icon set has no
      // trending pair, and an arrow that points left or right means opposite
      // things in the two languages this site renders in. The sign on the
      // figure and its colour carry the direction instead.
      icon: "swap_vert",
      tone: occupancyPoints === 0 ? undefined : occupancyPoints > 0 ? "up" : "down",
    },
    {
      label: t.admin.statRevenueChange,
      value: revenueChange === null ? t.common.none : arDeltaPercent(revenueChange, locale),
      sub: t.admin.statRevenueChangeSub,
      icon: "swap_vert",
      tone:
        revenueChange === null || revenueChange === 0
          ? undefined
          : revenueChange > 0
            ? "up"
            : "down",
    },

    /* ---- 16–17 · who is carrying the month ------------------------------ */
    {
      label: t.admin.statTopRevenue,
      value: current.topByRevenue ? listingName(current.topByRevenue) : t.admin.statNoData,
      sub: current.topByRevenue
        ? t.admin.statTopRevenueSub(arNum(current.topByRevenue.value, locale), thisMonthLabel)
        : t.admin.statWholeMonth(thisMonthLabel),
      icon: "diamond",
      href: current.topByRevenue ? `/admin/listings/${current.topByRevenue.id}` : undefined,
      isName: true,
    },
    {
      label: t.admin.statTopBookings,
      value: current.topByBookings ? listingName(current.topByBookings) : t.admin.statNoData,
      sub: current.topByBookings
        ? t.admin.statTopBookingsSub(arNum(current.topByBookings.value, locale), thisMonthLabel)
        : t.admin.statWholeMonth(thisMonthLabel),
      icon: "local_fire_department",
      href: current.topByBookings ? `/admin/listings/${current.topByBookings.id}` : undefined,
      isName: true,
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

      {/* Listings that are live-but-invisible because their owner lapsed. Money
          sitting still, and the only thing on this page with no tile of its own
          — every other alert an operator needs is one of the first four. */}
      {hiddenCount > 0 && (
        <Link
          href="/admin/owners"
          className="flex items-center gap-2 rounded-xl bg-busy-bg px-3.5 py-2.5 text-[12.5px] font-semibold text-busy no-underline hover:no-underline"
        >
          <Icon name="visibility_off" size={16} />
          {t.admin.hiddenListingsNote(arNum(hiddenCount, locale))}
        </Link>
      )}

      {/* ---- the seventeen tiles, in order ---- */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        {tiles.map((tile) => (
          <StatTile key={tile.label} tile={tile} />
        ))}
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

/**
 * One tile.
 *
 * The dot sits on the tile's own corner rather than beside the figure, matching
 * the badges already on the navigation tabs — an operator learns one signal for
 * "something here needs you" and it means the same thing everywhere.
 */
function StatTile({ tile }: { tile: Tile }) {
  const body = (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-muted">{tile.label}</span>
        <Icon
          name={tile.icon}
          size={20}
          className={clsx(
            tile.attention
              ? "text-busy"
              : tile.tone === "up"
                ? "text-ok"
                : tile.tone === "down"
                  ? "text-busy"
                  : "text-gold-600",
          )}
        />
      </div>
      <div
        className={clsx(
          "font-display font-extrabold text-ink",
          tile.isName
            ? "line-clamp-2 text-[15px] leading-snug"
            : "text-[26px] leading-none",
          tile.tone === "up" && "text-ok",
          tile.tone === "down" && "text-busy",
        )}
      >
        {tile.value}
      </div>
      <div className="mt-1 text-[11.5px] text-muted">{tile.sub}</div>

      {tile.attention && (
        <span
          className="absolute top-3 end-3 size-2 rounded-full bg-busy"
          aria-hidden
        />
      )}
    </>
  );

  const className = clsx(
    "relative rounded-[20px] border bg-surface p-4 shadow-e1 no-underline transition hover:no-underline",
    tile.attention ? "border-busy/35" : "border-line",
    tile.href && "hover:border-gold-500",
  );

  return tile.href ? (
    <Link href={tile.href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
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
