"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { authorizeListing } from "@/lib/listing-access";
import { isISODate, nightsInRange, todayISO, type ISODate } from "@/lib/dates";
import { LOCAL_SOURCE_KEY } from "@/lib/constants";
import type { ActionResult } from "./listings";
import { getI18n } from "@/lib/i18n/server";

/**
 * Availability editing — the calendar, for both an operator and an owner.
 *
 * A row in `Availability` means "not bookable". Three statuses:
 *   BLOCKED  — the owner closed the day (maintenance, personal use, offline)
 *   BOOKED   — a confirmed reservation on this platform occupies it
 *   EXTERNAL — imported from Airbnb/Booking.com by the iCal sync
 * Visitors see all three as unavailable; the distinction matters to the owner.
 *
 * ─── Who may call these ─────────────────────────────────────────────────────
 * Both actions used to be `requireAdmin()`, because /admin/calendar was the
 * only calendar. Owners now have their own at /owner/calendar, so the guard is
 * `authorizeListing()` (src/lib/listing-access.ts), which resolves operator OR
 * owner and — critically — scopes an owner's lookup with `ownerId` in the WHERE
 * clause. Widening the guard without that scope would have let any approved
 * owner block days on any listing on the platform.
 *
 * ─── Everything in this file operates on LOCAL rows only ────────────────────
 * An imported day belongs to the other platform. It is removed when that
 * platform stops advertising it and at no other time, so neither of the actions
 * below may touch one — `sourceKey: LOCAL_SOURCE_KEY` is in every query here
 * for that reason, not for tidiness.
 *
 * The consequence worth knowing: a day can carry BOTH an owner block and an
 * imported hold, as two rows. Freeing the owner's block then leaves the day
 * closed, because the other reason is still true. That is the honest answer,
 * and the calendar shows the imported hold so it does not look like a bug.
 */

/** Toggle a single day blocked/free. The core interaction of the calendar tab. */
export async function toggleBlockedDate(
  listingId: string,
  date: ISODate,
): Promise<ActionResult> {
  const { t } = await getI18n();

  const access = await authorizeListing(listingId, t);
  if (!access.ok) return { ok: false, error: access.error };
  const { listing } = access;

  if (!isISODate(date)) return { ok: false, error: t.validation.invalidDate };
  if (date < todayISO()) return { ok: false, error: t.validation.dateNotEditable };

  // `findFirst` scoped to LOCAL rather than `findUnique` on the compound key:
  // the key gained `sourceKey` when imported calendars arrived, so asking for
  // "the row for this listing on this day" is no longer a single-row question.
  const existing = await prisma.availability.findFirst({
    where: { listingId, date, sourceKey: LOCAL_SOURCE_KEY },
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
    // An imported hold on this day does not stop the owner adding their own
    // block. The two are independent reasons and each owns its row; if the
    // Airbnb booking is later cancelled, the owner's block must survive it.
    await prisma.availability.create({
      data: { listingId, date, status: "BLOCKED", sourceKey: LOCAL_SOURCE_KEY },
    });
  }

  revalidateCalendar(listing.slug);

  return { ok: true };
}

/**
 * Every surface a calendar edit changes.
 *
 * Both dashboards unconditionally: an owner blocking a day changes what the
 * operator's calendar should show, and revalidating a path nobody is looking at
 * costs nothing — while missing one leaves a stale cell somebody will click.
 */
function revalidateCalendar(slug: string): void {
  revalidatePath(`/listings/${slug}`);
  revalidatePath("/listings");
  revalidatePath("/admin/calendar");
  revalidatePath("/owner/calendar");
}

/** Block or free a whole range at once — for a season or a maintenance window. */
export async function setRangeBlocked(
  listingId: string,
  from: ISODate,
  to: ISODate,
  blocked: boolean,
): Promise<ActionResult> {
  const { t } = await getI18n();

  const access = await authorizeListing(listingId, t);
  if (!access.ok) return { ok: false, error: access.error };
  const { listing } = access;

  if (!isISODate(from) || !isISODate(to) || from >= to) {
    return { ok: false, error: t.validation.invalidRange };
  }

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
    // the @@unique([listingId, date, sourceKey]) constraint. It was unavailable
    // when the schema still had to run on SQLite; now that PostgreSQL is the
    // only provider it would work, but reading the existing dates first costs
    // one extra indexed SELECT at ≤400 rows, so there is nothing to gain by
    // rewriting it.
    //
    // Scoped to LOCAL, and that scope is load-bearing rather than decorative.
    // Without it, a day already held by an imported Airbnb booking would count
    // as "already recorded", so the owner's block would never be written — and
    // when Airbnb released the day, it would come back on the market despite
    // the owner having closed it.
    const existing = await prisma.availability.findMany({
      where: { listingId, date: { in: dates }, sourceKey: LOCAL_SOURCE_KEY },
      select: { date: true },
    });
    const already = new Set(existing.map((e) => e.date));
    const missing = dates.filter((d) => !already.has(d));

    if (missing.length > 0) {
      await prisma.availability.createMany({
        data: missing.map((date) => ({
          listingId,
          date,
          status: "BLOCKED",
          sourceKey: LOCAL_SOURCE_KEY,
        })),
      });
    }
  } else {
    // Only clear owner-BLOCKED days. Confirmed BOOKED days stay put, and so do
    // EXTERNAL ones — "free the rest of the month" is the owner speaking about
    // their own calendar, and it cannot release a night Airbnb has sold.
    await prisma.availability.deleteMany({
      where: {
        listingId,
        date: { in: dates },
        status: "BLOCKED",
        sourceKey: LOCAL_SOURCE_KEY,
      },
    });
  }

  revalidateCalendar(listing.slug);

  return {
    ok: true,
    message: blocked ? t.common.rangeBlocked : t.common.rangeFreed,
  };
}

/* ==========================================================================
 * Special days — the nights charged at `Listing.holidayPrice`
 * ==========================================================================
 *
 * A `SpecialDay` row is the opposite claim to an `Availability` row: it says
 * the night is very much for sale, at the occasion rate. The two tables are
 * independent and a day may appear in both — blocked AND marked — which simply
 * means it is closed and would have cost more had it been open.
 *
 * Which days these are cannot be computed: Eid moves with the Hijri year and is
 * fixed by moon sighting a day or two ahead, and "big occasion" also covers
 * things no table knows. So the owner marks them, here.
 */

/** Mark or unmark one day as a big occasion. */
export async function toggleSpecialDate(
  listingId: string,
  date: ISODate,
  label = "",
): Promise<ActionResult> {
  const { t } = await getI18n();

  const access = await authorizeListing(listingId, t);
  if (!access.ok) return { ok: false, error: access.error };
  const { listing } = access;

  if (!isISODate(date)) return { ok: false, error: t.validation.invalidDate };
  // Repricing a night in the past changes nothing that can still be booked, and
  // would silently disagree with what an existing booking was quoted.
  if (date < todayISO()) return { ok: false, error: t.validation.dateNotEditable };

  const existing = await prisma.specialDay.findUnique({
    where: { listingId_date: { listingId, date } },
    select: { id: true },
  });

  if (existing) {
    await prisma.specialDay.delete({ where: { id: existing.id } });
  } else {
    await prisma.specialDay.create({
      data: { listingId, date, label: label.trim().slice(0, 60) },
    });
  }

  revalidateCalendar(listing.slug);
  return { ok: true };
}

/**
 * Mark or unmark a whole range — a five-day Eid, or a New Year week.
 *
 * The occasions this exists for are runs of days, so marking them one tap at a
 * time is the common case rather than the exception.
 */
export async function setRangeSpecial(
  listingId: string,
  from: ISODate,
  to: ISODate,
  special: boolean,
  label = "",
): Promise<ActionResult> {
  const { t } = await getI18n();

  const access = await authorizeListing(listingId, t);
  if (!access.ok) return { ok: false, error: access.error };
  const { listing } = access;

  if (!isISODate(from) || !isISODate(to) || from >= to) {
    return { ok: false, error: t.validation.invalidRange };
  }

  const today = todayISO();
  const dates = nightsInRange(from, to).filter((d) => d >= today);
  if (dates.length === 0) return { ok: false, error: t.validation.noEditableDays };
  if (dates.length > 400) return { ok: false, error: t.validation.rangeTooLong };

  if (special) {
    // Read first, then insert the gaps — the same shape as `setRangeBlocked`
    // above, and for the same reason: one extra indexed SELECT at ≤400 rows,
    // and re-marking a day must not overwrite the label already on it.
    const existing = await prisma.specialDay.findMany({
      where: { listingId, date: { in: dates } },
      select: { date: true },
    });
    const already = new Set(existing.map((e) => e.date));
    const missing = dates.filter((d) => !already.has(d));

    if (missing.length > 0) {
      await prisma.specialDay.createMany({
        data: missing.map((date) => ({ listingId, date, label: label.trim().slice(0, 60) })),
      });
    }
  } else {
    await prisma.specialDay.deleteMany({ where: { listingId, date: { in: dates } } });
  }

  revalidateCalendar(listing.slug);

  return {
    ok: true,
    message: special ? t.calendar.rangeMarkedSpecial : t.calendar.rangeUnmarkedSpecial,
  };
}
