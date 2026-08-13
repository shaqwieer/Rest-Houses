"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { authorizeListing } from "@/lib/listing-access";
import { auditData } from "@/lib/audit";
import { nextReference } from "@/lib/booking-reference";
import { CAPACITY_MAX, isBookingSource, LOCAL_SOURCE_KEY } from "@/lib/constants";
import { isISODate, nightsBetween, occupiedDays, todayISO } from "@/lib/dates";
import { normalizeDigits } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import type { ActionResult } from "./listings";

/**
 * Recording a booking that came from somewhere else.
 *
 * ─── What this exists to fix ─────────────────────────────────────────────────
 * A rest house is rarely listed only here. The same weekend might be sold on
 * Airbnb, or to a guest who simply rang the owner. Before this, neither had
 * anywhere to live: an imported iCal feed carries dates and no prices, so the
 * dashboard could say Airbnb had closed nine nights and never what they were
 * worth, and a booking taken over WhatsApp was invisible unless the owner
 * blocked the days by hand — where it read as maintenance rather than money.
 *
 * So this is the one path in the application on which a human STATES the
 * amount. Everywhere else `quote()` computes it from the listing's price list,
 * deliberately, so a tampered form cannot book Eid at the weekday rate. That
 * protection is meaningless here and would be actively wrong: this platform's
 * price list has nothing to say about what Airbnb paid out. The amount is
 * therefore typed, and the guard is *authorisation* — only the owner of the
 * rest house, or an operator, may write one — plus the audit row below, which
 * records who stated the figure.
 *
 * ─── The calendar, and the one rule that decides everything ──────────────────
 * Whether this booking still needs days taken off the market:
 *
 *   • **Every day already in the past** → nothing is claimed. No clash check,
 *     no `Availability` rows. Those days are spent; writing "booked" onto them
 *     now would fight whatever is already there — very often the imported feed
 *     for the very booking being recorded — and refuse the entry for no gain.
 *     The row still carries its revenue, which is the entire point.
 *   • **Any day today or later** → a real claim on the calendar, so the full
 *     clash check runs and those days are written BOOKED, exactly as confirming
 *     a request does. Only the future days: the past ones are not contested.
 *
 * The clash check looks across EVERY source, matching `setStatusWithCalendar`
 * in ./requests.ts. It is tempting to let an Airbnb record write over a day the
 * Airbnb feed has already closed — surely the same booking — but a feed carries
 * dates and a title, not an identity. If it is in fact a different Airbnb
 * booking, the day is genuinely taken and this would be the first step towards
 * two guests at one gate. `occupiedDays` states the house rule: err towards an
 * occasional lost booking, never the other way.
 *
 * The same test decides the workflow stage. A retrospective record has no
 * handover left to run, so it is created DONE; a forward-dated one enters at
 * BALANCE like any other confirmation and the owner can work the stepper. That
 * matters more than it looks: `/owner/bookings` renders every CONFIRMED booking
 * whose stage is not DONE as an uncapped, never-paged work queue, so a season of
 * backfilled Airbnb stays entered at BALANCE would sit in it forever.
 *
 * ─── No commission ───────────────────────────────────────────────────────────
 * `commissionPercent` and `commissionDue` are written as 0. The platform's
 * commission is its cut of a booking it produced, and it did not produce this
 * one. Both are snapshot columns — the whole point of them is that a later rate
 * change cannot rewrite what is owed — so this is a permanent statement about
 * the booking, which is why the form says it on screen before submitting rather
 * than leaving it to be discovered in the figures.
 */

const MAX_AMOUNT = 10_000_000;
const MAX_NIGHTS = 60;

export async function recordBooking(formData: FormData): Promise<ActionResult> {
  const { t } = await getI18n();

  const text = (key: string) => String(formData.get(key) ?? "").trim();

  /* ---- who is asking, and about which rest house ------------------------- */
  //
  // `authorizeListing` resolves operator OR owner and — for an owner — puts
  // `ownerId` in the WHERE clause, so asking about somebody else's listing
  // answers "not found" rather than leaking that it exists.
  const listingId = text("listingId");
  const access = await authorizeListing(listingId, t);
  if (!access.ok) return { ok: false, error: access.error };
  const { listing, actor } = access;

  /* ---- the source ------------------------------------------------------- */
  const source = text("source");
  // "RIHLA" is rejected along with anything unrecognised. A booking made on
  // this platform is created by the public flow; letting one be typed here
  // would invent a Rihla booking the platform has no record of taking, on
  // which it would then be owed no commission.
  if (!isBookingSource(source) || source === "RIHLA") {
    return { ok: false, error: t.validation.invalidSource };
  }

  /* ---- the guest -------------------------------------------------------- */
  const customerName = text("customerName");
  if (customerName.length < 2) return { ok: false, error: t.validation.nameTooShort };

  // Normalised to ASCII digits before storing, the same shape the public flow
  // stores — the customer directory and the repeat-guest count both key on this
  // string, and an Arabic-keyboard number would split one guest into two.
  const customerPhone = normalizeDigits(text("customerPhone")).replace(/[^0-9+]/g, "");
  if (customerPhone.replace(/\D/g, "").length < 7) {
    return { ok: false, error: t.validation.phoneInvalid };
  }

  /* ---- the dates -------------------------------------------------------- */
  const checkIn = text("checkIn");
  const dayUse = formData.get("dayUse") === "on" || formData.get("dayUse") === "true";
  // A day-use stay leaves and arrives on one day, so the form has no check-out
  // field for it and the row stores `checkOut === checkIn` — the literal truth.
  // See the note on `BookingRequest.dayUse` in prisma/schema.prisma.
  const checkOut = dayUse ? checkIn : text("checkOut");

  if (!isISODate(checkIn)) return { ok: false, error: t.validation.invalidCheckIn };
  if (!isISODate(checkOut)) return { ok: false, error: t.validation.invalidCheckOut };

  const nights = dayUse ? 0 : nightsBetween(checkIn, checkOut);
  if (!dayUse && nights < 1) {
    return { ok: false, error: t.validation.checkOutBeforeCheckIn };
  }
  if (nights > MAX_NIGHTS) return { ok: false, error: t.validation.tooManyNights };

  /* ---- the numbers ------------------------------------------------------ */
  const guests = Number(normalizeDigits(text("guests")));
  if (!Number.isInteger(guests) || guests < 1 || guests > CAPACITY_MAX) {
    return { ok: false, error: t.validation.guestsInvalid };
  }

  // Deliberately NOT checked against `listing.capacity`. This is a record of
  // something that already happened somewhere else, and refusing to write down
  // a party of 45 because the listing says 40 would lose the revenue rather
  // than correct the number.

  const amount = Number(normalizeDigits(text("amount")));
  // Zero is allowed and means it: a stay given to family is still a stay, and
  // it belongs on the calendar and in the occupancy figure.
  if (!Number.isInteger(amount) || amount < 0 || amount > MAX_AMOUNT) {
    return { ok: false, error: t.validation.amountInvalid };
  }

  const notes = text("notes").slice(0, 2000);

  /* ---- the calendar ----------------------------------------------------- */
  const today = todayISO();
  const days = occupiedDays(checkIn, checkOut, dayUse);
  const daysAhead = days.filter((day) => day >= today);
  const retrospective = daysAhead.length === 0;

  if (!retrospective) {
    const clash = await prisma.availability.findFirst({
      where: { listingId: listing.id, date: { in: daysAhead } },
      select: { date: true },
    });
    if (clash) return { ok: false, error: t.validation.dateConflict(clash.date) };
  }

  /* ---- write ------------------------------------------------------------ */
  //
  // One interactive transaction, not a create followed by a batch. The booking
  // row, the nights it closes and the counter behind the public "past bookings"
  // figure have to commit together — a create that succeeded while the calendar
  // write failed would leave a confirmed booking whose dates are still on sale,
  // which is the exact failure `setStatusWithCalendar` uses a transaction to
  // prevent. Interactive rather than the array form because the audit row needs
  // the booking's id, which does not exist until the insert has run.
  const reference = await nextReference();

  const booking = await prisma.$transaction(async (tx) => {
    const created = await tx.bookingRequest.create({
      data: {
        reference,
        listingId: listing.id,
        customerName,
        customerPhone,
        notes: notes || null,
        checkIn,
        checkOut,
        nights,
        dayUse,
        guests,
        source,

        // What the owner says it was worth. `serviceFee` is 0 because this
        // platform charged none, so `total` is the same figure — both columns
        // still mean exactly what they mean everywhere else.
        subtotal: amount,
        serviceFee: 0,
        total: amount,

        // Nothing was collected through this platform, so there is no deposit
        // to chase and no security deposit it is holding. 0, not null: these
        // are "not applicable" rather than "this step has not happened yet".
        depositDue: 0,
        depositPercent: 0,
        securityDeposit: 0,

        // See the note at the top of this file.
        commissionPercent: 0,
        commissionDue: 0,

        status: "CONFIRMED",
        stage: retrospective ? "DONE" : "BALANCE",
        // Step 1 is complete by definition — whatever money there was changed
        // hands elsewhere before this row existed.
        depositConfirmedAt: new Date(),
      },
      select: { id: true, reference: true },
    });

    // Only the days ahead, and only when there are any. `skipDuplicates` is
    // not needed: the clash check above proved none of these rows exist, and
    // it ran moments ago against the same listing.
    if (!retrospective) {
      await tx.availability.createMany({
        data: daysAhead.map((date) => ({
          listingId: listing.id,
          date,
          status: "BOOKED",
          sourceKey: LOCAL_SOURCE_KEY,
        })),
      });
    }

    // Incremented here because cancelling this booking later goes through
    // `setStatusWithCalendar`, which decrements unconditionally. A create that
    // skipped this would let one cancellation drive the public "past bookings"
    // figure on the listing page below zero.
    await tx.listing.update({
      where: { id: listing.id },
      data: { bookingsCount: { increment: 1 } },
    });

    await tx.auditLog.create({
      data: auditData({
        actor,
        action: "BOOKING_RECORDED",
        entityType: "BookingRequest",
        entityId: created.id,
        summary: `${created.reference} · ${listing.name} · ${customerName}`,
        // The facts that cannot be re-derived later: which channel this was
        // claimed for, and what figure a human typed.
        metadata: { source, amount, checkIn, checkOut, dayUse, retrospective },
      }),
    });

    return created;
  });

  revalidatePath("/owner/bookings");
  revalidatePath("/admin/requests");
  revalidatePath("/owner");
  revalidatePath("/owner/insights");
  revalidatePath("/admin/insights");
  revalidatePath(`/listings/${listing.slug}`);

  return { ok: true, id: booking.id, message: t.validation.bookingRecorded };
}
