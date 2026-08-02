import Link from "next/link";
import { RequestCard } from "@/components/admin/request-card";
import { Icon } from "@/components/ui/icon";
import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { ownerReplyMessage, whatsappLink } from "@/lib/whatsapp";
import { BOOKING_STATUSES, isBookingStatus } from "@/lib/constants";
import { getI18n } from "@/lib/i18n/server";
import { arNum } from "@/lib/format";

/** Booking requests, filterable by status via `?status=NEW`. */
export default async function AdminRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage();

  const sp = await searchParams;
  const statusFilter = isBookingStatus(sp.status) ? sp.status : null;
  const { t, locale } = await getI18n();

  /**
   * Pending requests are fetched SEPARATELY and uncapped.
   *
   * A single capped query cannot guarantee they appear, whichever way it is
   * ordered — and this page exists to surface them:
   *   • `orderBy: status ASC` sorts alphabetically (CANCELLED, CONFIRMED, NEW,
   *     REJECTED), so the window fills with closed requests first.
   *   • `orderBy: createdAt DESC` drops the *oldest* NEW ones — which are
   *     precisely the ones that have been waiting longest for a reply.
   * Both were reproduced against 250 rows before settling on this split.
   *
   * NEW is a work queue the operator actively drains, so it is bounded in
   * practice; the closed history is what grows without limit, so only that is
   * capped.
   */
  const [pending, history, counts, settings] = await Promise.all([
    statusFilter && statusFilter !== "NEW"
      ? Promise.resolve([])
      : prisma.bookingRequest.findMany({
          where: { status: "NEW" },
          // Oldest first: the request that has waited longest needs answering.
          orderBy: { createdAt: "asc" },
          include: { listing: { select: { name: true, slug: true } } },
        }),
    statusFilter === "NEW"
      ? Promise.resolve([])
      : prisma.bookingRequest.findMany({
          where: statusFilter ? { status: statusFilter } : { status: { not: "NEW" } },
          orderBy: { createdAt: "desc" },
          include: { listing: { select: { name: true, slug: true } } },
          take: 200,
        }),
    prisma.bookingRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    getSettings(),
  ]);

  const countFor = (status: string) => counts.find((c) => c.status === status)?._count._all ?? 0;
  const totalCount = counts.reduce((sum, c) => sum + c._count._all, 0);
  const newCount = countFor("NEW");

  // Pending first (already oldest-first within itself), then the recent history.
  // No further sorting needed — each query is already in its intended order.
  const ordered = [...pending, ...history];
  const historyCapped = history.length === 200;

  return (
    <div className="animate-fade-up">
      <h1 className="m-0 mb-1 font-display text-[20px] font-extrabold text-ink">
        {t.admin.bookingsTitle}
      </h1>
      <p className="m-0 mb-3.5 text-[13.5px] text-muted">
        {newCount > 0
          ? t.admin.pendingRequestsLine(arNum(newCount, locale))
          : t.admin.noPendingRequests}
      </p>

      {/* status filter chips */}
      <div className="no-scrollbar mb-4 flex gap-1.5 overflow-x-auto pb-1">
        <FilterChip href="/admin/requests" active={!statusFilter}>
          {t.common.all} ({arNum(totalCount, locale)})
        </FilterChip>
        {BOOKING_STATUSES.map((status) => (
          <FilterChip
            key={status}
            href={`/admin/requests?status=${status}`}
            active={statusFilter === status}
          >
            {t.status[status]} ({arNum(countFor(status), locale)})
          </FilterChip>
        ))}
      </div>

      {ordered.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-sand-300 bg-surface p-8 text-center">
          <Icon name="inbox" size={46} className="mx-auto text-sand-400" />
          <h2 className="mt-3.5 mb-2 font-display text-[17px] font-bold text-ink">
            {t.admin.noRequestsYet}
          </h2>
        </div>
      ) : (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {ordered.map((r) => (
            <RequestCard
              key={r.id}
              request={{
                id: r.id,
                reference: r.reference,
                listingName: r.listing.name,
                listingSlug: r.listing.slug,
                customerName: r.customerName,
                customerPhone: r.customerPhone,
                customerEmail: r.customerEmail,
                checkIn: r.checkIn,
                checkOut: r.checkOut,
                nights: r.nights,
                guests: r.guests,
                total: r.total,
                depositDue: r.depositDue,
                // The snapshotted rate, not the listing's current one — an
                // owner changing their deposit must not relabel old bookings.
                depositPercent: r.depositPercent,
                notes: r.notes,
                status: r.status,
                // The operator's reply link targets the *customer's* number,
                // with an opening message referencing their request pre-typed.
                whatsappHref: whatsappLink(
                  r.customerPhone,
                  ownerReplyMessage({
                    siteName: settings.siteName,
                    customerName: r.customerName,
                    reference: r.reference,
                    listingName: r.listing.name,
                    locale,
                  }),
                ),
              }}
            />
          ))}
        </div>
      )}

      {/* Never let a cap look like "that's everything". */}
      {historyCapped && (
        <p className="mt-4 flex items-center gap-2 text-[12.5px] text-muted">
          <Icon name="info" size={16} className="text-bronze" />
          {t.admin.historyCapped}
        </p>
      )}
    </div>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`shrink-0 rounded-full border px-3.5 py-2 text-[12.5px] no-underline transition hover:no-underline ${
        active
          ? "border-gold-600 bg-gold-100 font-bold text-bronze"
          : "border-line bg-surface font-medium text-ink hover:border-gold-500"
      }`}
    >
      {children}
    </Link>
  );
}
