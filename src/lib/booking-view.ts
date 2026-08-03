import type { Prisma } from "@prisma/client";
import type { WorkflowBooking } from "@/components/admin/booking-workflow";
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
