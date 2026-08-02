"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthorizationError, requireAdmin, requireApprovedOwner } from "@/lib/auth";
import { isBookingStatus } from "@/lib/constants";
import { nightsInRange } from "@/lib/dates";
import { getI18n } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n";
import type { ActionResult } from "./listings";

/**
 * Booking-request management.
 *
 * Confirming a request is the moment a *request* becomes a *reservation*: that's
 * when its nights get written into `Availability` as BOOKED, closing the dates
 * to everyone else. Submitting the public form deliberately does NOT do this —
 * otherwise anyone could take a calendar offline by spamming the form.
 *
 * ─── Two entry points, one implementation ────────────────────────────────────
 * `setRequestStatus` (admin, any request) and `setOwnerRequestStatus` (an owner,
 * their own requests only) differ in exactly one thing: which rows they are
 * allowed to load. Everything after that — the clash re-check, the transaction
 * that moves status, calendar and counter together, the release of BOOKED nights
 * — is `applyRequestStatus` below, called by both.
 *
 * That is deliberate rather than tidy-minded. The confirmation path is the one
 * piece of this application where three tables must agree, and two hand-kept
 * copies of it would drift: the first bug fixed in one and not the other leaves
 * a listing whose calendar says free while its bookings say taken.
 */

/** Turn a guard failure into a translated result rather than a 500. */
function guardResult(error: unknown, t: Dictionary): ActionResult {
  if (error instanceof AuthorizationError) {
    return {
      ok: false,
      error:
        error.code === "OWNER_INACTIVE" ? t.validation.ownerInactive : t.validation.unauthorized,
    };
  }
  throw error;
}

export async function setRequestStatus(
  requestId: string,
  status: string,
): Promise<ActionResult> {
  const { t } = await getI18n();

  try {
    await requireAdmin();
  } catch (error) {
    return guardResult(error, t);
  }

  return applyRequestStatus({ id: requestId }, status, t);
}

/**
 * The same operation, scoped to one owner's own rest houses.
 *
 * An owner answering a request for their own استراحة is the normal case, not an
 * escalation: they are the person the guest is actually dealing with, and making
 * them wait for an operator to press "confirm" is how a booking goes cold. The
 * calendar rows it writes belong to their own listing.
 *
 * `listing: { ownerId }` goes in the **WHERE clause**, not in a check after the
 * read. An owner passing another owner's request id gets "not found" — the same
 * answer as for an id that does not exist, which is both the correct
 * authorisation outcome and the one that confirms nothing about which other
 * requests exist (IDOR).
 *
 * Deleting a request stays admin-only. Rejecting one already tells the guest
 * everything the owner needs it to; erasing the record is a moderation action
 * (spam, duplicates) and it destroys the operator's audit trail.
 */
export async function setOwnerRequestStatus(
  requestId: string,
  status: string,
): Promise<ActionResult> {
  const { t } = await getI18n();

  let ownerId: string;
  try {
    // Re-reads status and membership from the database, so a suspended owner
    // cannot answer requests with a token minted while they were approved.
    ({
      owner: { id: ownerId },
    } = await requireApprovedOwner());
  } catch (error) {
    return guardResult(error, t);
  }

  return applyRequestStatus({ id: requestId, listing: { ownerId } }, status, t);
}

/**
 * Move a request to `status`, keeping the calendar and the booking counter in
 * step with it.
 *
 * `where` carries the caller's authorisation scope and is applied by the
 * database, so this function never has to be trusted to re-check it.
 */
async function applyRequestStatus(
  where: Prisma.BookingRequestWhereInput,
  status: string,
  t: Dictionary,
): Promise<ActionResult> {
  if (!isBookingStatus(status)) return { ok: false, error: t.validation.invalidStatus };

  const request = await prisma.bookingRequest.findFirst({
    where,
    select: {
      id: true,
      status: true,
      listingId: true,
      checkIn: true,
      checkOut: true,
      listing: { select: { slug: true } },
    },
  });
  if (!request) return { ok: false, error: t.validation.requestNotFound };

  const requestId = request.id;
  const nights = nightsInRange(request.checkIn, request.checkOut);

  if (status === "CONFIRMED") {
    // Someone else may have been confirmed for overlapping dates in the
    // meantime, so re-check before closing the calendar.
    const clash = await prisma.availability.findFirst({
      where: { listingId: request.listingId, date: { in: nights } },
      select: { date: true },
    });
    if (clash) {
      return {
        ok: false,
        error: t.validation.dateConflict(clash.date),
      };
    }

    // Status + calendar + counter move together: a half-applied confirmation
    // would leave dates open on a booked listing.
    //
    // No `skipDuplicates` here (see the same note in actions/availability.ts):
    // the clash check above already proved none of these nights exist — inside
    // the transaction that stays true.
    await prisma.$transaction([
      prisma.bookingRequest.update({
        where: { id: requestId },
        data: { status: "CONFIRMED" },
      }),
      prisma.availability.createMany({
        data: nights.map((date) => ({
          listingId: request.listingId,
          date,
          status: "BOOKED",
        })),
      }),
      prisma.listing.update({
        where: { id: request.listingId },
        data: { bookingsCount: { increment: 1 } },
      }),
    ]);
  } else if (request.status === "CONFIRMED") {
    // Moving away from CONFIRMED (reject/cancel) releases the nights again, but
    // only the BOOKED rows — days the owner blocked by hand stay blocked.
    await prisma.$transaction([
      prisma.bookingRequest.update({ where: { id: requestId }, data: { status } }),
      prisma.availability.deleteMany({
        where: { listingId: request.listingId, date: { in: nights }, status: "BOOKED" },
      }),
      prisma.listing.update({
        where: { id: request.listingId },
        data: { bookingsCount: { decrement: 1 } },
      }),
    ]);
  } else {
    await prisma.bookingRequest.update({ where: { id: requestId }, data: { status } });
  }

  // Both dashboards, unconditionally. A confirmation made by an owner still
  // changes what the operator's queue and calendar should show, and revalidating
  // a path nobody is looking at costs nothing — while missing one leaves a stale
  // request card that someone will press a second time.
  revalidatePath("/admin");
  revalidatePath("/admin/requests");
  revalidatePath("/admin/calendar");
  revalidatePath("/owner");
  revalidatePath("/owner/bookings");
  revalidatePath(`/listings/${request.listing.slug}`);
  revalidatePath("/listings");

  const messages: Record<string, string> = {
    CONFIRMED: t.common.requestConfirmed,
    REJECTED: t.common.requestRejected,
    CANCELLED: t.common.requestCancelled,
    NEW: t.common.requestReturned,
  };

  return { ok: true, message: messages[status] };
}

/** Remove a request permanently — for spam or duplicates. */
export async function deleteRequest(requestId: string): Promise<ActionResult> {
  await requireAdmin();
  const { t } = await getI18n();

  const request = await prisma.bookingRequest.findUnique({
    where: { id: requestId },
    select: { status: true, listingId: true, checkIn: true, checkOut: true },
  });
  if (!request) return { ok: false, error: t.validation.requestNotFound };

  // Deleting a confirmed request must not leave its dates blocked forever.
  if (request.status === "CONFIRMED") {
    await prisma.availability.deleteMany({
      where: {
        listingId: request.listingId,
        date: { in: nightsInRange(request.checkIn, request.checkOut) },
        status: "BOOKED",
      },
    });
  }

  await prisma.bookingRequest.delete({ where: { id: requestId } });

  revalidatePath("/admin");
  revalidatePath("/admin/requests");
  revalidatePath("/admin/calendar");

  return { ok: true, message: t.common.deleted };
}
