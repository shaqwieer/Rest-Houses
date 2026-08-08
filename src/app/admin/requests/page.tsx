import Link from "next/link";
import { RequestCard } from "@/components/admin/request-card";
import { Icon } from "@/components/ui/icon";
import { prisma } from "@/lib/prisma";
import { requireAdminPage } from "@/lib/auth";
import { bankDetails, getSettings } from "@/lib/settings";
import { ownerReplyMessage, whatsappLink } from "@/lib/whatsapp";
import { BOOKING_STATUSES, isBookingStatus } from "@/lib/constants";
import { toWorkflowBooking, WORKFLOW_INCLUDE } from "@/lib/booking-view";
import { getI18n } from "@/lib/i18n/server";
import { arNum } from "@/lib/format";
import { ARCHIVE_PAGE_SIZE, Pager, pageFromParam } from "@/components/admin/pager";

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
   * paginated.
   *
   * The archive used to be capped at 200 rows rendered in one go, with a note
   * apologising for the cap. Every card carries its own seven-step handover
   * stepper, so that was a page several thousand pixels tall on a phone — and
   * the 201st closed booking was simply unreachable. Paging reaches all of them
   * and renders 24 at a time. The pending queue is deliberately NOT paged: it
   * is the work, it is short, and burying half of it behind "next" is the one
   * thing this page must not do.
   */
  const [counts, settings] = await Promise.all([
    prisma.bookingRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    getSettings(),
  ]);

  const countFor = (status: string) => counts.find((c) => c.status === status)?._count._all ?? 0;
  const totalCount = counts.reduce((sum, c) => sum + c._count._all, 0);
  const newCount = countFor("NEW");

  /**
   * How many closed bookings this filter covers, derived from the counts above
   * rather than a second COUNT query — `groupBy` already knows.
   */
  const archiveTotal = statusFilter
    ? statusFilter === "NEW"
      ? 0
      : countFor(statusFilter)
    : totalCount - newCount;
  const totalPages = Math.max(1, Math.ceil(archiveTotal / ARCHIVE_PAGE_SIZE));
  // Clamped BEFORE the query. `?page=99` on a two-page archive would otherwise
  // skip past the end and render the "no requests yet" empty state, which reads
  // as data loss rather than as a bad URL.
  const page = pageFromParam(sp.page, totalPages);

  const [pending, history] = await Promise.all([
    // The pending queue belongs to the first page only. Repeating it above every
    // page of the archive would re-render the heaviest cards on the screen for
    // somebody who is browsing history, not draining a queue.
    (statusFilter && statusFilter !== "NEW") || page > 1
      ? Promise.resolve([])
      : prisma.bookingRequest.findMany({
          where: { status: "NEW" },
          // Oldest first: the request that has waited longest needs answering.
          orderBy: { createdAt: "asc" },
          include: WORKFLOW_INCLUDE,
        }),
    statusFilter === "NEW"
      ? Promise.resolve([])
      : prisma.bookingRequest.findMany({
          where: statusFilter ? { status: statusFilter } : { status: { not: "NEW" } },
          orderBy: { createdAt: "desc" },
          include: WORKFLOW_INCLUDE,
          skip: (page - 1) * ARCHIVE_PAGE_SIZE,
          take: ARCHIVE_PAGE_SIZE,
        }),
  ]);

  // Pending first (already oldest-first within itself), then this page of the
  // history. No further sorting needed — each query is already in its order.
  const ordered = [...pending, ...history];

  const hrefFor = (n: number) => {
    const query = new URLSearchParams();
    // The active filter has to survive a page change, or page 2 of "CONFIRMED"
    // silently becomes page 2 of everything.
    if (statusFilter) query.set("status", statusFilter);
    if (n > 1) query.set("page", String(n));
    const qs = query.toString();
    return qs ? `/admin/requests?${qs}` : "/admin/requests";
  };

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
        {/* Each chip resets to page 1 — a filter change makes the old page
            number meaningless, and landing on an empty page 3 of a filter with
            two pages reads as "nothing here". */}
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
              reviewInviteDays={settings.reviewInviteDays}
              bank={bankDetails(settings)}
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
                dayUse: r.dayUse,
                guests: r.guests,
                total: r.total,
                depositDue: r.depositDue,
                // The snapshotted rate, not the listing's current one — an
                // owner changing their deposit must not relabel old bookings.
                depositPercent: r.depositPercent,
                notes: r.notes,
                status: r.status,
                workflow: toWorkflowBooking(r),
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

      <Pager page={page} totalPages={totalPages} hrefFor={hrefFor} t={t} locale={locale} />
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
