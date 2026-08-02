"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { isISODate, nightsInRange, todayISO, type ISODate } from "@/lib/dates";
import type { ActionResult } from "./listings";
import { getI18n } from "@/lib/i18n/server";

/**
 * Availability editing — the owner's calendar.
 *
 * A row in `Availability` means "not bookable". Two statuses:
 *   BLOCKED — the owner closed the day (maintenance, personal use, held offline)
 *   BOOKED  — a confirmed reservation occupies it
 * Visitors see both as unavailable; the distinction only matters to the owner.
 */

/** Toggle a single day blocked/free. The core interaction of the calendar tab. */
export async function toggleBlockedDate(
  listingId: string,
  date: ISODate,
): Promise<ActionResult> {
  await requireAdmin();
  const { t } = await getI18n();

  if (!isISODate(date)) return { ok: false, error: t.validation.invalidDate };
  if (date < todayISO()) return { ok: false, error: t.validation.dateNotEditable };

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { slug: true },
  });
  if (!listing) return { ok: false, error: t.validation.listingNotFound };

  const existing = await prisma.availability.findUnique({
    where: { listingId_date: { listingId, date } },
    select: { id: true, status: true },
  });

  if (existing) {
    // Refuse to silently free a day that a confirmed booking occupies — the
    // owner should cancel the booking, which releases the day deliberately.
    if (existing.status === "BOOKED") {
      return {
        ok: false,
        error: t.validation.dayHeldByBooking,
      };
    }
    await prisma.availability.delete({ where: { id: existing.id } });
  } else {
    await prisma.availability.create({
      data: { listingId, date, status: "BLOCKED" },
    });
  }

  revalidatePath(`/listings/${listing.slug}`);
  revalidatePath("/listings");
  revalidatePath("/admin/calendar");

  return { ok: true };
}

/** Block or free a whole range at once — for a season or a maintenance window. */
export async function setRangeBlocked(
  listingId: string,
  from: ISODate,
  to: ISODate,
  blocked: boolean,
): Promise<ActionResult> {
  await requireAdmin();
  const { t } = await getI18n();

  if (!isISODate(from) || !isISODate(to) || from >= to) {
    return { ok: false, error: t.validation.invalidRange };
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { slug: true },
  });
  if (!listing) return { ok: false, error: t.validation.listingNotFound };

  const today = todayISO();
  const dates = nightsInRange(from, to).filter((d) => d >= today);
  if (dates.length === 0) {
    return { ok: false, error: t.validation.noEditableDays };
  }
  if (dates.length > 400) return { ok: false, error: t.validation.rangeTooLong };

  if (blocked) {
    // Insert only the days that aren't already recorded.
    //
    // `createMany({ skipDuplicates: true })` would be the obvious way to lean on
    // the @@unique([listingId, date]) constraint. It was unavailable when the
    // schema still had to run on SQLite; now that PostgreSQL is the only
    // provider it would work, but reading the existing dates first costs one
    // extra indexed SELECT at ≤400 rows, so there is nothing to gain by
    // rewriting it.
    const existing = await prisma.availability.findMany({
      where: { listingId, date: { in: dates } },
      select: { date: true },
    });
    const already = new Set(existing.map((e) => e.date));
    const missing = dates.filter((d) => !already.has(d));

    if (missing.length > 0) {
      await prisma.availability.createMany({
        data: missing.map((date) => ({ listingId, date, status: "BLOCKED" })),
      });
    }
  } else {
    // Only clear owner-BLOCKED days; confirmed BOOKED days stay put.
    await prisma.availability.deleteMany({
      where: { listingId, date: { in: dates }, status: "BLOCKED" },
    });
  }

  revalidatePath(`/listings/${listing.slug}`);
  revalidatePath("/listings");
  revalidatePath("/admin/calendar");

  return {
    ok: true,
    message: blocked ? t.common.rangeBlocked : t.common.rangeFreed,
  };
}
