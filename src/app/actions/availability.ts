"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { authorizeListing } from "@/lib/listing-access";
import { auditData } from "@/lib/audit";
import { isISODate, nightsInRange, todayISO, type ISODate } from "@/lib/dates";
import { LOCAL_SOURCE_KEY } from "@/lib/constants";
import type { ActionResult } from "./listings";
import { getI18n } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n/ar";

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
 *
 * ─── Every change here leaves a line in the activity log ────────────────────
 * Closing a night takes it off the market, so "who closed this, and when" has
 * to be answerable after the fact — by the operator, about an owner, and the
 * other way round. Each write shares a transaction with its log row (see
 * src/lib/audit.ts), and an action that changed nothing writes no row: "blocked
 * the rest of October" on a month that was already closed would be a line
 * describing something that did not happen.
 */

/** Toggle a single day blocked/free. The core interaction of the calendar tab. */
export async function toggleBlockedDate(
  listingId: string,
  date: ISODate,
): Promise<ActionResult> {
  const { t } = await getI18n();

  const access = await authorizeListing(listingId, t);
  if (!access.ok) return { ok: false, error: access.error };
  const { listing, actor } = access;

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
    await prisma.$transaction([
      prisma.availability.delete({ where: { id: existing.id } }),
      prisma.auditLog.create({
        data: auditData({
          actor,
          action: "DAYS_UNBLOCKED",
          entityType: "Listing",
          entityId: listingId,
          summary: listing.name,
          metadata: { date },
        }),
      }),
    ]);
  } else {
    // An imported hold on this day does not stop the owner adding their own
    // block. The two are independent reasons and each owns its row; if the
    // Airbnb booking is later cancelled, the owner's block must survive it.
    await prisma.$transaction([
      prisma.availability.create({
        data: { listingId, date, status: "BLOCKED", sourceKey: LOCAL_SOURCE_KEY },
      }),
      prisma.auditLog.create({
        data: auditData({
          actor,
          action: "DAYS_BLOCKED",
          entityType: "Listing",
          entityId: listingId,
          summary: listing.name,
          metadata: { date },
        }),
      }),
    ]);
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
  const { listing, actor } = access;

  if (!isISODate(from) || !isISODate(to) || from >= to) {
    return { ok: false, error: t.validation.invalidRange };
  }

  const today = todayISO();
  const dates = nightsInRange(from, to).filter((d) => d >= today);
  if (dates.length === 0) {
    return { ok: false, error: t.validation.noEditableDays };
  }
  if (dates.length > 400) return { ok: false, error: t.validation.rangeTooLong };

  // The nights actually acted on, not the arguments: `to` is exclusive (the
  // editor sends the first of next month) and `from` may have been clipped to
  // today, so either would put a day in the log that nothing touched.
  const rangeLog = (action: "DAYS_BLOCKED" | "DAYS_UNBLOCKED", days: number) =>
    auditData({
      actor,
      action,
      entityType: "Listing",
      entityId: listingId,
      summary: listing.name,
      metadata: { from: dates[0], to: dates[dates.length - 1], days },
    });

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
      await prisma.$transaction([
        prisma.availability.createMany({
          data: missing.map((date) => ({
            listingId,
            date,
            status: "BLOCKED",
            sourceKey: LOCAL_SOURCE_KEY,
          })),
        }),
        prisma.auditLog.create({ data: rangeLog("DAYS_BLOCKED", missing.length) }),
      ]);
    }
  } else {
    // Only clear owner-BLOCKED days. Confirmed BOOKED days stay put, and so do
    // EXTERNAL ones — "free the rest of the month" is the owner speaking about
    // their own calendar, and it cannot release a night Airbnb has sold.
    //
    // Interactive rather than an array because the log row needs the count:
    // how many of these days were actually closed is only known once they go.
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.availability.deleteMany({
        where: {
          listingId,
          date: { in: dates },
          status: "BLOCKED",
          sourceKey: LOCAL_SOURCE_KEY,
        },
      });
      if (count > 0) {
        await tx.auditLog.create({ data: rangeLog("DAYS_UNBLOCKED", count) });
      }
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
 *
 * ─── A day may carry its own price ──────────────────────────────────────────
 * `SpecialDay.price` overrides `Listing.holidayPrice` for that one night — New
 * Year's Eve at 8,000 while the other public holidays stay at 5,000. null is
 * "use the listing's occasion rate", and it is what a blank price box sends.
 */

/**
 * A day price as the calendar sends it: a whole number of dirhams, or null for
 * "no price of its own". 0 and blank both normalise to null — a marked night is
 * never free, and "no rate of its own" already has a spelling.
 *
 * The floor is the listing's weekday rate, for the reason `holidayPrice` has
 * one in `weekendRateProblem` (src/app/actions/listings.ts): an occasion night
 * outranks every other tier in `nightRate`, so a typo below the weekday rate
 * would make Eid the cheapest night of the year.
 */
async function occasionPrice(
  listingId: string,
  raw: number | null | undefined,
  t: Dictionary,
): Promise<{ ok: true; price: number | null } | { ok: false; error: string }> {
  if (raw === null || raw === undefined || raw === 0) return { ok: true, price: null };
  if (!Number.isInteger(raw) || raw < 0 || raw > 1_000_000) {
    return { ok: false, error: t.validation.occasionPriceInvalid };
  }

  const listing = await prisma.listing.findUniqueOrThrow({
    where: { id: listingId },
    select: { pricePerNight: true },
  });
  if (raw < listing.pricePerNight) return { ok: false, error: t.validation.holidayBelowWeekday };

  return { ok: true, price: raw };
}

/**
 * Mark or unmark one day as a big occasion.
 *
 * `price` applies only when marking; unmarking removes the row and its price
 * with it. Changing the price of a day that is already marked is
 * `updateSpecialDate` below — a toggle that sometimes edited instead of
 * unmarking would make one tap mean two different things.
 */
export async function toggleSpecialDate(
  listingId: string,
  date: ISODate,
  label = "",
  price: number | null = null,
): Promise<ActionResult> {
  const { t } = await getI18n();

  const access = await authorizeListing(listingId, t);
  if (!access.ok) return { ok: false, error: access.error };
  const { listing, actor } = access;

  if (!isISODate(date)) return { ok: false, error: t.validation.invalidDate };
  // Repricing a night in the past changes nothing that can still be booked, and
  // would silently disagree with what an existing booking was quoted.
  if (date < todayISO()) return { ok: false, error: t.validation.dateNotEditable };

  const existing = await prisma.specialDay.findUnique({
    where: { listingId_date: { listingId, date } },
    select: { id: true, label: true, publicHolidayId: true },
  });

  if (existing) {
    await prisma.$transaction([
      prisma.specialDay.delete({ where: { id: existing.id } }),
      prisma.auditLog.create({
        data: auditData({
          actor,
          action: "SPECIAL_DAYS_UNMARKED",
          entityType: "Listing",
          entityId: listingId,
          summary: listing.name,
          // The label it had, so the line still says which Eid; and whether
          // it was this listing's copy of a platform holiday — an owner opting
          // out of «التقويم الشامل» rather than undoing their own mark.
          metadata: {
            date,
            label: existing.label,
            publicHoliday: existing.publicHolidayId !== null,
          },
        }),
      }),
    ]);
  } else {
    const priced = await occasionPrice(listingId, price, t);
    if (!priced.ok) return priced;

    const clean = label.trim().slice(0, 60);
    await prisma.$transaction([
      prisma.specialDay.create({
        data: { listingId, date, label: clean, price: priced.price },
      }),
      prisma.auditLog.create({
        data: auditData({
          actor,
          action: "SPECIAL_DAYS_MARKED",
          entityType: "Listing",
          entityId: listingId,
          summary: listing.name,
          metadata: { date, label: clean, price: priced.price },
        }),
      }),
    ]);
  }

  revalidateCalendar(listing.slug);
  return { ok: true };
}

/**
 * Rename a marked day, or give it a price of its own — the owner who wants New
 * Year's Eve at 8,000 when the platform marked it at their 5,000 rate.
 *
 * ─── An edited copy of a public holiday becomes the owner's ─────────────────
 * `publicHolidayId` is cleared, so the row stops being a copy of the
 * platform-wide holiday. Otherwise the operator unmarking that holiday on
 * /admin/holidays would cascade-delete it, and the 8,000 the owner set would go
 * with it. Clearing it is what an owner re-marking the day by hand already got
 * — see `SpecialDay.publicHolidayId` in prisma/schema.prisma.
 */
export async function updateSpecialDate(
  listingId: string,
  date: ISODate,
  label: string,
  price: number | null,
): Promise<ActionResult> {
  const { t } = await getI18n();

  const access = await authorizeListing(listingId, t);
  if (!access.ok) return { ok: false, error: access.error };
  const { listing, actor } = access;

  if (!isISODate(date)) return { ok: false, error: t.validation.invalidDate };
  if (date < todayISO()) return { ok: false, error: t.validation.dateNotEditable };

  const priced = await occasionPrice(listingId, price, t);
  if (!priced.ok) return priced;

  const existing = await prisma.specialDay.findUnique({
    where: { listingId_date: { listingId, date } },
    select: { id: true, label: true, price: true, publicHolidayId: true },
  });
  // Unmarked in another tab since this calendar loaded. Editing it back into
  // existence would undo that, so refuse and let the refresh show the truth.
  if (!existing) return { ok: false, error: t.validation.invalidDate };

  const clean = label.trim().slice(0, 60);
  // Nothing changed: no write and no log line, the rule this file keeps for
  // every action.
  if (clean === existing.label && priced.price === existing.price) {
    return { ok: true, message: t.calendar.occasionSaved };
  }

  await prisma.$transaction([
    prisma.specialDay.update({
      where: { id: existing.id },
      data: { label: clean, price: priced.price, publicHolidayId: null },
    }),
    prisma.auditLog.create({
      data: auditData({
        actor,
        action: "SPECIAL_DAY_UPDATED",
        entityType: "Listing",
        entityId: listingId,
        summary: listing.name,
        metadata: {
          date,
          label: clean,
          price: priced.price,
          previous: { label: existing.label, price: existing.price },
          publicHoliday: existing.publicHolidayId !== null,
        },
      }),
    }),
  ]);

  revalidateCalendar(listing.slug);
  return { ok: true, message: t.calendar.occasionSaved };
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
  price: number | null = null,
): Promise<ActionResult> {
  const { t } = await getI18n();

  const access = await authorizeListing(listingId, t);
  if (!access.ok) return { ok: false, error: access.error };
  const { listing, actor } = access;

  if (!isISODate(from) || !isISODate(to) || from >= to) {
    return { ok: false, error: t.validation.invalidRange };
  }

  const today = todayISO();
  const dates = nightsInRange(from, to).filter((d) => d >= today);
  if (dates.length === 0) return { ok: false, error: t.validation.noEditableDays };
  if (dates.length > 400) return { ok: false, error: t.validation.rangeTooLong };

  const clean = label.trim().slice(0, 60);

  // Checked before anything is written, and only when marking — unmarking a
  // range takes no price.
  const priced = special ? await occasionPrice(listingId, price, t) : null;
  if (priced && !priced.ok) return priced;
  const dayPrice = priced?.ok ? priced.price : null;

  // The nights acted on, for the same reason as in `setRangeBlocked`.
  const rangeLog = (
    action: "SPECIAL_DAYS_MARKED" | "SPECIAL_DAYS_UNMARKED",
    days: number,
    extra: Record<string, unknown> = {},
  ) =>
    auditData({
      actor,
      action,
      entityType: "Listing",
      entityId: listingId,
      summary: listing.name,
      metadata: { from: dates[0], to: dates[dates.length - 1], days, ...extra },
    });

  if (special) {
    // Read first, then insert the gaps — the same shape as `setRangeBlocked`
    // above, and for the same reason: one extra indexed SELECT at ≤400 rows,
    // and re-marking a day must not overwrite the label already on it — nor
    // its price, so marking the rest of December at 5,000 leaves New Year's
    // Eve at the 8,000 already set on it.
    const existing = await prisma.specialDay.findMany({
      where: { listingId, date: { in: dates } },
      select: { date: true },
    });
    const already = new Set(existing.map((e) => e.date));
    const missing = dates.filter((d) => !already.has(d));

    if (missing.length > 0) {
      await prisma.$transaction([
        prisma.specialDay.createMany({
          data: missing.map((date) => ({ listingId, date, label: clean, price: dayPrice })),
        }),
        prisma.auditLog.create({
          data: rangeLog("SPECIAL_DAYS_MARKED", missing.length, {
            label: clean,
            price: dayPrice,
          }),
        }),
      ]);
    }
  } else {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.specialDay.deleteMany({
        where: { listingId, date: { in: dates } },
      });
      if (count > 0) {
        await tx.auditLog.create({ data: rangeLog("SPECIAL_DAYS_UNMARKED", count) });
      }
    });
  }

  revalidateCalendar(listing.slug);

  return {
    ok: true,
    message: special ? t.calendar.rangeMarkedSpecial : t.calendar.rangeUnmarkedSpecial,
  };
}
