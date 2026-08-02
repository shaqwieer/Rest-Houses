import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { getActiveOwnerSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { arNum, arPercent } from "@/lib/format";
import { addDays, arDayMonth, arFullDate, todayISO } from "@/lib/dates";

/**
 * Owner overview.
 *
 * Every query below is scoped by `ownerId` — either directly or through
 * `listing: { ownerId }`. An owner must never see another owner's requests,
 * revenue or occupancy, and scoping in the WHERE clause is what guarantees that
 * rather than filtering after the fact.
 */
export default async function OwnerOverviewPage() {
  // null while the owner is pending/rejected/suspended/expired — the layout
  // is rendering the status panel and discards this page's output.
  const session = await getActiveOwnerSession();
  if (!session) return null;
  const { owner } = session;
  const { t, locale } = await getI18n();

  const today = todayISO();
  const monthAhead = addDays(today, 30);
  const ownedListings = { listing: { ownerId: owner.id } };

  const [newCount, confirmedCount, listingCount, publishedCount, recent, bookedNights, revenue] =
    await Promise.all([
      prisma.bookingRequest.count({ where: { status: "NEW", ...ownedListings } }),
      prisma.bookingRequest.count({ where: { status: "CONFIRMED", ...ownedListings } }),
      prisma.listing.count({ where: { ownerId: owner.id } }),
      prisma.listing.count({ where: { ownerId: owner.id, published: true } }),
      prisma.bookingRequest.findMany({
        where: ownedListings,
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { listing: { select: { name: true } } },
      }),
      prisma.availability.count({
        where: {
          status: "BOOKED",
          date: { gte: today, lt: monthAhead },
          listing: { ownerId: owner.id },
        },
      }),
      prisma.bookingRequest.aggregate({
        where: { status: "CONFIRMED", checkIn: { gte: today, lt: monthAhead }, ...ownedListings },
        _sum: { total: true },
      }),
    ]);

  const capacityNights = publishedCount * 30;
  const occupancyPct = capacityNights > 0 ? Math.round((bookedNights / capacityNights) * 100) : 0;

  const stats: { label: string; value: string; sub: string; icon: IconName }[] = [
    {
      label: t.admin.statNewRequests,
      value: arNum(newCount, locale),
      sub: t.admin.statNewRequestsSub,
      icon: "mark_email_unread",
    },
    {
      label: t.admin.statConfirmed,
      value: arNum(confirmedCount, locale),
      sub: t.admin.statConfirmedSub,
      icon: "task_alt",
    },
    {
      label: t.admin.statOccupancy,
      value: arPercent(occupancyPct, locale),
      sub: t.admin.statOccupancySub,
      icon: "donut_large",
    },
    {
      label: t.admin.statRevenue,
      value: arNum(revenue._sum.total ?? 0, locale),
      sub: t.admin.statRevenueSub,
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
          {newCount > 0
            ? t.admin.pendingRequestsLine(arNum(newCount, locale))
            : t.admin.noPendingRequests}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-[20px] border border-line bg-surface p-4 shadow-e1">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-muted">{s.label}</span>
              <Icon name={s.icon} size={20} className="text-gold-600" />
            </div>
            <div className="font-display text-[26px] font-extrabold leading-none text-ink">
              {s.value}
            </div>
            <div className="mt-1 text-[11.5px] text-muted">{s.sub}</div>
          </div>
        ))}
      </div>

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
                <StatusBadge status={r.status} />
              </Link>
            ))}
          </div>
        )}
      </div>

      <Link
        href="/owner/listings/new"
        className="flex items-center gap-3 rounded-[20px] bg-night-900 p-4 text-start text-sand-50 no-underline transition hover:bg-night-700 hover:no-underline"
      >
        <Icon name="add_home" size={23} className="text-gold-300" />
        <span className="text-[13.5px] font-bold">{t.owner.addListing}</span>
      </Link>

      {listingCount === 0 && (
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
