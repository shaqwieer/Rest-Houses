import { RequestCard } from "@/components/admin/request-card";
import { Icon } from "@/components/ui/icon";
import { prisma } from "@/lib/prisma";
import { getActiveOwnerSession } from "@/lib/auth";
import { bankDetails, getSettings } from "@/lib/settings";
import { platformPaymentModes } from "@/lib/payments";
import { ownerReplyMessage, whatsappLink } from "@/lib/whatsapp";
import { BOOKING_FILTERS, isBookingFilter } from "@/lib/constants";
import {
  ARCHIVED_BOOKINGS_WHERE,
  BOOKING_ORDER,
  bookingFilterCounts,
  bookingFilterWhere,
  isActiveFilter,
  toWorkflowBooking,
  WORKFLOW_INCLUDE,
} from "@/lib/booking-view";
import { getI18n } from "@/lib/i18n/server";
import { arNum } from "@/lib/format";
import { ARCHIVE_PAGE_SIZE, Pager, pageFromParam } from "@/components/admin/pager";
import Link from "next/link";

/**
 * The owner's booking requests.
 *
 * Every query is filtered by `listing: { ownerId }`, so an owner sees requests
 * for their own rest houses and nothing else.
 *
 * The bucket split and the reading order are the admin page's — see the long
 * note in src/app/admin/requests/page.tsx for why the work queue is fetched
 * separately and never paged, and src/lib/booking-view.ts for the predicates
 * both pages share. Only the closed archive is paged; see the note in
 * src/components/admin/pager.tsx.
 */
export default async function OwnerBookingsPage({
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
  const filter = isBookingFilter(sp.status) ? sp.status : null;
  const mine = { listing: { ownerId: owner.id } };

  const [counts, settings] = await Promise.all([bookingFilterCounts(mine), getSettings()]);

  const newCount = counts.NEW;

  // Which bucket this filter reads from, and how much of it there is — derived
  // from the counts already fetched rather than a second COUNT.
  const showQueue = !filter || isActiveFilter(filter);
  const showArchive = !filter || !isActiveFilter(filter);
  const archiveTotal = !showArchive
    ? 0
    : filter
      ? counts[filter]
      : counts.COMPLETED + counts.REJECTED + counts.CANCELLED;

  const totalPages = Math.max(1, Math.ceil(archiveTotal / ARCHIVE_PAGE_SIZE));
  // Clamped before the query, so `?page=99` lands on the last real page rather
  // than skipping past the end into the "no bookings yet" empty state.
  const page = pageFromParam(sp.page, totalPages);

  // First page only — an owner reading their archive is not draining a queue.
  const queueVisible = showQueue && page === 1;

  const [pending, active, history] = await Promise.all([
    queueVisible && filter !== "CONFIRMED"
      ? prisma.bookingRequest.findMany({
          where: { ...bookingFilterWhere("NEW"), ...mine },
          orderBy: BOOKING_ORDER.pending,
          include: WORKFLOW_INCLUDE,
        })
      : Promise.resolve([]),
    queueVisible && filter !== "NEW"
      ? prisma.bookingRequest.findMany({
          where: { ...bookingFilterWhere("CONFIRMED"), ...mine },
          orderBy: BOOKING_ORDER.active,
          include: WORKFLOW_INCLUDE,
        })
      : Promise.resolve([]),
    showArchive
      ? prisma.bookingRequest.findMany({
          where: filter
            ? { ...bookingFilterWhere(filter), ...mine }
            : { ...ARCHIVED_BOOKINGS_WHERE, ...mine },
          orderBy: BOOKING_ORDER.archive,
          include: WORKFLOW_INCLUDE,
          skip: (page - 1) * ARCHIVE_PAGE_SIZE,
          take: ARCHIVE_PAGE_SIZE,
        })
      : Promise.resolve([]),
  ]);

  // Unanswered first (oldest waiting first), then confirmed by how soon the
  // guest arrives, then history. Each query is already in its own order, so the
  // concatenation is the order — nothing is sorted here.
  const ordered = [...pending, ...active, ...history];

  const hrefFor = (n: number) => {
    const query = new URLSearchParams();
    // The active filter survives a page change — otherwise page 2 of one status
    // quietly becomes page 2 of all of them.
    if (filter) query.set("status", filter);
    if (n > 1) query.set("page", String(n));
    const qs = query.toString();
    return qs ? `/owner/bookings?${qs}` : "/owner/bookings";
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 mb-1 font-display text-[20px] font-extrabold text-ink">
            {t.owner.myBookings}
          </h1>
          <p className="m-0 text-[13.5px] text-muted">
            {newCount > 0
              ? t.admin.pendingRequestsLine(arNum(newCount, locale))
              : t.admin.noPendingRequests}
          </p>
        </div>

        {/* The way in for a stay taken over WhatsApp or on another site. It
            belongs here rather than on the calendar: what is being recorded is
            a booking with a guest and a price, and blocking the days is a
            consequence of that rather than the point of it. */}
        <Link
          href="/owner/bookings/new"
          className="inline-flex items-center gap-1.5 rounded-full bg-night-900 px-4 py-2.5 text-[12.5px] font-bold text-sand-50 no-underline transition hover:bg-night-700 hover:no-underline"
        >
          <Icon name="add" size={16} className="text-gold-300" />
          {t.recordBooking.open}
        </Link>
      </div>

      <div className="no-scrollbar mb-4 flex gap-1.5 overflow-x-auto pb-1">
        <FilterChip href="/owner/bookings" active={!filter}>
          {t.common.all} ({arNum(counts.total, locale)})
        </FilterChip>
        {BOOKING_FILTERS.map((f) => (
          <FilterChip
            key={f}
            href={`/owner/bookings?status=${f}`}
            active={filter === f}
          >
            {t.status[f]} ({arNum(counts[f], locale)})
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
              // Confirm / reject / cancel, scoped by the server action to this
              // owner's own rest houses. The calendar rows a confirmation writes
              // belong to their own listing, so there is nothing here an
              // operator needs to do on their behalf.
              scope="owner"
              reviewInviteDays={settings.reviewInviteDays}
              bank={bankDetails(settings)}
              // Whether Rihla can issue a payment link at all. Resolved
              // here because it depends on gateway credentials, which the
              // browser must not be told about — what crosses is the
              // verdict. False everywhere today, and the control in step 2
              // renders nothing when it is.
              canIssuePaymentLink={platformPaymentModes(settings).includes("LINK")}
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
                depositPercent: r.depositPercent,
                notes: r.notes,
                status: r.status,
                workflow: toWorkflowBooking(r),
                // The reply link targets the *customer's* number, with an
                // opening message referencing their request already typed.
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
