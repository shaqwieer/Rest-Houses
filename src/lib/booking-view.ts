import type { Prisma } from "@prisma/client";
import type { WorkflowBooking } from "@/components/admin/booking-workflow";
import { bookingDisplayStatus, BOOKING_FILTERS, type BookingFilter } from "./constants";
import { prisma } from "./prisma";
import { reviewInviteUrl } from "./reviews";

/**
 * The shape the booking stepper needs, and the one query fragment that fetches
 * it.
 *
 * Both the operator's queue and the owner's list render the same card, so the
 * selection and the mapping live here rather than in each page. Two hand-kept
 * copies of a 20-column select is how one of them ends up missing
 * `securityCollected` and the step that returns it quietly shows 0.
 */

/**
 * Relations the stepper reads. `include` rather than `select` because both
 * pages already pull the whole booking row — the workflow columns are on it —
 * and only the two relations need adding.
 */
export const WORKFLOW_INCLUDE = {
  listing: { select: { name: true, slug: true } },
  reviewInvite: { select: { token: true, expiresAt: true, usedAt: true } },
  review: { select: { status: true } },
} satisfies Prisma.BookingRequestInclude;

type BookingWithWorkflow = Prisma.BookingRequestGetPayload<{
  include: typeof WORKFLOW_INCLUDE;
}>;

export function toWorkflowBooking(row: BookingWithWorkflow): WorkflowBooking {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    stage: row.stage,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    listingName: row.listing.name,

    total: row.total,
    depositDue: row.depositDue,
    securityDeposit: row.securityDeposit,
    commissionDue: row.commissionDue,
    commissionPercent: row.commissionPercent,

    depositCollected: row.depositCollected,
    securityCollected: row.securityCollected,
    balanceCollected: row.balanceCollected,
    damageDeduction: row.damageDeduction,
    securityReturned: row.securityReturned,
    inspectionNotes: row.inspectionNotes,
    commissionReference: row.commissionReference,

    depositConfirmedAt: row.depositConfirmedAt,
    balancePaidAt: row.balancePaidAt,
    checkedOutAt: row.checkedOutAt,
    inspectedAt: row.inspectedAt,
    securityReturnedAt: row.securityReturnedAt,
    commissionSentAt: row.commissionSentAt,
    commissionConfirmedAt: row.commissionConfirmedAt,
    reviewInvitedAt: row.reviewInvitedAt,

    // A spent invite stops being a link to hand out — the guest has already
    // used it, and the card shows the review's moderation state instead.
    reviewInviteUrl:
      row.reviewInvite && !row.reviewInvite.usedAt
        ? reviewInviteUrl(row.reviewInvite.token)
        : null,
    reviewInviteExpiresAt: row.reviewInvite?.expiresAt ?? null,
    reviewStatus: row.review?.status ?? null,
  };
}

/* --------------------------------------------------------------------------
 * Which bookings are still work, which are history, and in what order.
 *
 * Shared by /admin/requests and /owner/bookings for the same reason
 * WORKFLOW_INCLUDE is: the two pages must agree, and the agreement here is an
 * exact complement — every booking belongs to precisely one of the two buckets,
 * or the "page N of M" figure stops matching what is on screen and reads as
 * data loss.
 * -------------------------------------------------------------------------- */

/**
 * Still on somebody's desk: an unanswered request, or a confirmed booking whose
 * seven-step handover has not run out of steps.
 *
 * Uncapped in both pages, and only on page 1. This is the queue an operator
 * drains, so it is bounded in practice, and burying half of it behind "next" is
 * the one thing these pages must not do.
 */
export const ACTIVE_BOOKINGS_WHERE: Prisma.BookingRequestWhereInput = {
  OR: [{ status: "NEW" }, { status: "CONFIRMED", stage: { not: "DONE" } }],
};

/**
 * Everything else — completed, rejected, cancelled.
 *
 * Written as the NEGATION of the active predicate rather than as a list of
 * statuses, so the two can never drift apart. The tempting
 * `status: { notIn: ["NEW", "CONFIRMED"] }` is wrong in a way that is invisible
 * until it bites: it drops every COMPLETED booking (they are CONFIRMED) out of
 * both buckets, and they simply vanish from the page.
 */
export const ARCHIVED_BOOKINGS_WHERE: Prisma.BookingRequestWhereInput = {
  NOT: ACTIVE_BOOKINGS_WHERE,
};

/**
 * The order each bucket is read in. Three lists rather than one comparator, and
 * three queries concatenated rather than a sort in JS, because Prisma cannot
 * order by a CASE expression and because "each query is already in its order"
 * is the property that keeps the concatenation obviously correct.
 *
 * `checkIn` is a "YYYY-MM-DD" string, so a lexicographic sort IS a chronological
 * one. `id` is the final tiebreaker everywhere: without it, rows that tie on the
 * sort key have no defined order, which on a paged list can show the same
 * booking on two pages and hide another entirely.
 */
export const BOOKING_ORDER = {
  /** Unanswered requests: the one that has waited longest needs a reply first. */
  pending: [{ createdAt: "asc" }, { id: "asc" }],
  /**
   * Confirmed bookings still being worked: soonest check-in first.
   *
   * A stay that started in the past therefore sorts ABOVE one arriving next
   * week, which is deliberate — a booking whose guest has already left and
   * whose commission nobody has remitted is the most overdue thing on the page,
   * not the least.
   */
  active: [{ checkIn: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  /** History: most recently requested first. */
  archive: [{ createdAt: "desc" }, { id: "desc" }],
} satisfies Record<string, Prisma.BookingRequestOrderByWithRelationInput[]>;

/** The rows one filter chip selects. */
export function bookingFilterWhere(filter: BookingFilter): Prisma.BookingRequestWhereInput {
  switch (filter) {
    case "CONFIRMED":
      // "مؤكد" now means confirmed AND still in progress — the completed ones
      // have their own chip, and counting them twice would make the chips add
      // up to more than the "all" chip beside them.
      return { status: "CONFIRMED", stage: { not: "DONE" } };
    case "COMPLETED":
      return { status: "CONFIRMED", stage: "DONE" };
    default:
      return { status: filter };
  }
}

/** Which chips live in the uncapped work queue rather than the paged archive. */
export function isActiveFilter(filter: BookingFilter): boolean {
  return filter === "NEW" || filter === "CONFIRMED";
}

export type BookingFilterCounts = Record<BookingFilter, number> & { total: number };

/**
 * One count per chip, from a single `groupBy`.
 *
 * Grouped by status AND stage because "COMPLETED" is a combination of the two;
 * a `groupBy(["status"])` cannot see it. `scope` narrows to one owner's
 * listings on /owner/bookings and is omitted for the operator.
 *
 * The invariant every caller depends on: the five chips sum to `total`.
 */
export async function bookingFilterCounts(
  scope?: Prisma.BookingRequestWhereInput,
): Promise<BookingFilterCounts> {
  const rows = await prisma.bookingRequest.groupBy({
    by: ["status", "stage"],
    where: scope,
    _count: { _all: true },
  });

  const counts = Object.fromEntries(BOOKING_FILTERS.map((f) => [f, 0])) as BookingFilterCounts;
  counts.total = 0;

  for (const row of rows) {
    const n = row._count._all;
    counts.total += n;
    const key = bookingDisplayStatus(row.status, row.stage);
    // A row carrying a status this build does not know about still counts
    // towards the total — it exists — but has no chip to land in.
    if (key in counts && key !== "total") counts[key as BookingFilter] += n;
  }

  return counts;
}
