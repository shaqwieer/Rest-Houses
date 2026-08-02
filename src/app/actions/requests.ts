"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { isBookingStatus } from "@/lib/constants";
import { nightsInRange } from "@/lib/dates";
import { getI18n } from "@/lib/i18n/server";
import type { ActionResult } from "./listings";

/**
 * Booking-request management.
 *
 * Confirming a request is the moment a *request* becomes a *reservation*: that's
 * when its nights get written into `Availability` as BOOKED, closing the dates
 * to everyone else. Submitting the public form deliberately does NOT do this —
 * otherwise anyone could take a calendar offline by spamming the form.
 */
export async function setRequestStatus(
  requestId: string,
  status: string,
): Promise<ActionResult> {
  await requireAdmin();
  const { t } = await getI18n();

  if (!isBookingStatus(status)) return { ok: false, error: t.validation.invalidStatus };

  const request = await prisma.bookingRequest.findUnique({
    where: { id: requestId },
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
    // `skipDuplicates` isn't available on SQLite (see the same note in
    // actions/availability.ts), and the clash check above already proved none of
    // these nights exist — inside the transaction that stays true.
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

  revalidatePath("/admin");
  revalidatePath("/admin/requests");
  revalidatePath("/admin/calendar");
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
