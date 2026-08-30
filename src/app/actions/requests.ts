"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthorizationError, requireAdmin, requireApprovedOwner } from "@/lib/auth";
import { auditData } from "@/lib/audit";
import {
  BOOKING_STAGES,
  isBookingStage,
  isBookingStatus,
  LOCAL_SOURCE_KEY,
  nextStage,
  type BookingStage,
} from "@/lib/constants";
import { occupiedDays, todayISO } from "@/lib/dates";
import { generateInviteToken, reviewInviteUrl } from "@/lib/reviews";
import { getSettings } from "@/lib/settings";
import { recordManualPayment } from "@/lib/payments";
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

  const where = { id: requestId, listing: { ownerId } };

  /**
   * An owner may not touch a booking whose dates have already begun.
   *
   * Moving a CONFIRMED booking to any other status deletes its BOOKED rows from
   * `Availability`, so doing it to a stay that has started or finished rewrites
   * a calendar other decisions were made against — and wipes out the platform's
   * commission on a stay that actually happened. The operator keeps the ability
   * to do it, because reconstructing a booking that went wrong is exactly their
   * job, and the audit log records that it was them.
   *
   * Checked here rather than only in the card: a server action is reachable by
   * anyone who knows its id, so a disabled button is a courtesy, not a rule.
   */
  if (status !== "CONFIRMED") {
    const booking = await prisma.bookingRequest.findFirst({
      where,
      select: { status: true, checkIn: true },
    });
    if (booking && booking.status === "CONFIRMED" && booking.checkIn <= todayISO()) {
      return { ok: false, error: t.validation.pastBookingLocked };
    }
  }

  return applyRequestStatus(where, status, t);
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
  /**
   * Extra columns to write in the SAME update as the status change.
   *
   * This exists for step 1 of the handover workflow, which is not a second
   * operation that happens to follow a confirmation — it *is* the confirmation.
   * The owner recording the deposit they received is what moves the request to
   * CONFIRMED, closes the calendar and advances the stage, and those four
   * writes have to commit together or the booking ends up confirmed at a stage
   * that says it never was (or the reverse).
   */
  extra: Prisma.BookingRequestUpdateInput = {},
  /**
   * An audit row to commit alongside the change, built by `auditData()`.
   *
   * Appended to the same `$transaction` array rather than written after it —
   * see the note at the top of src/lib/audit.ts for why a log that can survive
   * its own failed change is worse than no log.
   */
  audit?: Prisma.AuditLogCreateInput,
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
      dayUse: true,
      listing: { select: { slug: true } },
    },
  });
  if (!request) return { ok: false, error: t.validation.requestNotFound };

  const requestId = request.id;
  // The days this booking takes off the market — the single night-or-day
  // question, answered in one place. A day-use booking has no nights, so
  // `nightsInRange` would return an empty list here and this confirmation would
  // block nothing at all, leaving the day bookable by the next guest. See
  // `occupiedDays` in src/lib/dates.ts.
  const nights = occupiedDays(request.checkIn, request.checkOut, request.dayUse);

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
        data: {
          status: "CONFIRMED",
          // A confirmation always completes step 1, whichever path reached it.
          // Spelling that out here rather than only in the stepper's action is
          // what stops a booking existing as CONFIRMED while its stage still
          // says "waiting for the deposit" — the stepper would then offer to
          // confirm a booking that is already confirmed. `extra` is spread
          // afterwards so the stepper's own amounts still win.
          stage: "BALANCE",
          depositConfirmedAt: new Date(),
          ...extra,
        },
      }),
      prisma.availability.createMany({
        // `sourceKey: LOCAL` is what the clash check above searched *across*:
        // the check looks at every source, so an imported Airbnb hold already
        // refused this confirmation. What is written here is this platform's
        // own claim on the nights, and only a cancellation here removes it.
        data: nights.map((date) => ({
          listingId: request.listingId,
          date,
          status: "BOOKED",
          sourceKey: LOCAL_SOURCE_KEY,
        })),
      }),
      prisma.listing.update({
        where: { id: request.listingId },
        data: { bookingsCount: { increment: 1 } },
      }),
      ...(audit ? [prisma.auditLog.create({ data: audit })] : []),
    ]);
  } else if (request.status === "CONFIRMED") {
    // Moving away from CONFIRMED (reject/cancel) releases the nights again, but
    // only the BOOKED rows — days the owner blocked by hand stay blocked.
    await prisma.$transaction([
      prisma.bookingRequest.update({
        where: { id: requestId },
        data: { status, stage: "DEPOSIT", ...extra },
      }),
      prisma.availability.deleteMany({
        where: {
          listingId: request.listingId,
          date: { in: nights },
          status: "BOOKED",
          sourceKey: LOCAL_SOURCE_KEY,
        },
      }),
      prisma.listing.update({
        where: { id: request.listingId },
        data: { bookingsCount: { decrement: 1 } },
      }),
      ...(audit ? [prisma.auditLog.create({ data: audit })] : []),
    ]);
  } else {
    await prisma.$transaction([
      prisma.bookingRequest.update({
        where: { id: requestId },
        data: { status, stage: "DEPOSIT", ...extra },
      }),
      ...(audit ? [prisma.auditLog.create({ data: audit })] : []),
    ]);
  }

  // Both dashboards, unconditionally. A confirmation made by an owner still
  // changes what the operator's queue and calendar should show, and revalidating
  // a path nobody is looking at costs nothing — while missing one leaves a stale
  // request card that someone will press a second time.
  //
  // /admin/payments included because confirming is step 1 of the handover, and
  // step 1 is exactly what moves the confirmed-value and commission totals on
  // that page.
  revalidateBookingViews(request.listing.slug);

  const messages: Record<string, string> = {
    CONFIRMED: t.common.requestConfirmed,
    REJECTED: t.common.requestRejected,
    CANCELLED: t.common.requestCancelled,
    NEW: t.common.requestReturned,
  };

  return { ok: true, message: messages[status] };
}

/**
 * Confirm a booking because a payment for it has been VERIFIED.
 *
 * Called from the payment callback path — see
 * src/app/api/payments/[provider]/shared.ts — and from nowhere else.
 *
 * ─── Why this exists rather than the callback writing the columns ───────────
 * Confirming is not a status change. It writes the stay's nights into
 * `Availability` as BOOKED, increments the listing's counter, advances the
 * handover stage and revalidates both dashboards — and it has to re-check for a
 * clash first, because somebody else may have been confirmed for overlapping
 * dates while the guest was on the provider's payment page. All of that already
 * exists, correctly, in `applyRequestStatus`. A second copy in the payment layer
 * is precisely the drift this file's header warns about.
 *
 * ─── Why it takes no session, and what makes that safe ─────────────────────
 * Every other path into `applyRequestStatus` is guarded by `requireAdmin` or
 * `requireApprovedOwner`. This one has no signed-in user at all: the caller is a
 * gateway callback, and the guest is not an account holder on this platform.
 *
 * The authorisation is the VERIFIED PAYMENT — so this function takes a
 * `paymentId` and re-reads that row itself, rather than accepting a booking and
 * an amount from whoever called it. That is the difference between a comment
 * asserting the caller did the right thing and a function that cannot be made to
 * do the wrong one: it is exported from a `"use server"` module, which makes it
 * reachable as a POST, and a signature of `(bookingId, amount)` would let anyone
 * who guessed a booking id confirm a stay and close a calendar.
 *
 * What it therefore checks for itself:
 *   * the payment exists
 *   * its status is PAID — set only by `settlePayment`, which is reached only
 *     through a server-side verification against the provider
 * The booking and the amount are then DERIVED from that row, so they cannot
 * disagree with the money that was actually taken.
 *
 * ─── When the nights have gone ──────────────────────────────────────────────
 * The guest has paid and the dates are no longer available. This does NOT undo
 * the payment and does not confirm the booking: it writes an audit row saying so
 * and returns the failure, leaving a paid, unconfirmed booking for an operator
 * to refund or rebook. Quietly confirming over the clash would double-sell a
 * rest house; quietly discarding the payment would lose money that has left the
 * guest's account. Both are worse than a queue entry.
 */
export async function confirmBookingForPayment(
  paymentId: string,
): Promise<{ ok: true; confirmed: boolean } | { ok: false; error: string }> {
  const { t } = await getI18n();

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      status: true,
      amount: true,
      kind: true,
      provider: true,
      providerRef: true,
      booking: { select: { id: true, reference: true, status: true } },
    },
  });

  // No such payment, or one that has not actually settled. Either way there is
  // no authority here to confirm anything, and saying so is the whole guard.
  if (!payment) return { ok: false, error: t.validation.requestNotFound };
  if (payment.status !== "PAID") return { ok: false, error: t.validation.unauthorized };

  const booking = payment.booking;

  // Already confirmed (the payment-link flow always is), or rejected/cancelled.
  // Not a failure — there is simply nothing to confirm, and a second webhook
  // for the same payment must not report an error the provider would retry.
  if (booking.status !== "NEW") return { ok: true, confirmed: false };

  const actor = { id: null, email: "system:payments", role: "SYSTEM" };

  const result = await applyRequestStatus(
    { id: booking.id },
    "CONFIRMED",
    t,
    {
      stage: "BALANCE",
      depositConfirmedAt: new Date(),
      // What actually arrived, read off the settled payment — the same
      // distinction step 1 of the workflow draws between `depositDue` and
      // `depositCollected`.
      depositCollected: payment.amount,
    },
    auditData({
      actor,
      action: "BOOKING_STAGE_ADVANCED",
      entityType: "BookingRequest",
      entityId: booking.id,
      summary: `${booking.reference} — confirmed by ${payment.provider} payment`,
      metadata: {
        step: "DEPOSIT",
        scope: "payment",
        provider: payment.provider,
        providerRef: payment.providerRef,
        amount: payment.amount,
      },
    }),
  );

  if (!result.ok) {
    await prisma.auditLog.create({
      data: auditData({
        actor,
        action: "PAYMENT_NEEDS_REVIEW",
        entityType: "BookingRequest",
        entityId: booking.id,
        summary: `${booking.reference} — paid, but could not be confirmed`,
        metadata: {
          provider: payment.provider,
          providerRef: payment.providerRef,
          amount: payment.amount,
          reason: result.error,
        },
      }),
    });
    return { ok: false, error: result.error };
  }

  return { ok: true, confirmed: true };
}

/** Remove a request permanently — for spam or duplicates. */
export async function deleteRequest(requestId: string): Promise<ActionResult> {
  await requireAdmin();
  const { t } = await getI18n();

  const request = await prisma.bookingRequest.findUnique({
    where: { id: requestId },
    select: {
      status: true,
      listingId: true,
      checkIn: true,
      checkOut: true,
      dayUse: true,
    },
  });
  if (!request) return { ok: false, error: t.validation.requestNotFound };

  // Deleting a confirmed request must not leave its dates blocked forever.
  if (request.status === "CONFIRMED") {
    await prisma.availability.deleteMany({
      where: {
        listingId: request.listingId,
        date: { in: occupiedDays(request.checkIn, request.checkOut, request.dayUse) },
        status: "BOOKED",
        sourceKey: LOCAL_SOURCE_KEY,
      },
    });
  }

  await prisma.bookingRequest.delete({ where: { id: requestId } });

  revalidatePath("/admin");
  revalidatePath("/admin/requests");
  revalidatePath("/admin/calendar");

  return { ok: true, message: t.common.deleted };
}

/* ==========================================================================
 * The handover workflow — the seven steps of settling one booking
 * ==========================================================================
 *
 * Confirming a booking used to be one button. It is now a sequence the owner
 * walks, because the steps after "confirmed" are where this business actually
 * goes wrong: a balance nobody chased, a security deposit nobody returned, a
 * commission nobody remitted. Each step is a claim about the real world that
 * somebody has to stand behind, so each is its own explicit act with its own
 * timestamp and its own audit entry.
 *
 * ─── Every step re-states which step it is ──────────────────────────────────
 * `input.step` must equal the booking's current stage or the action refuses.
 * That is not belt-and-braces: an owner's phone and their laptop are routinely
 * both open on the same list, and without it the second tab's "confirm
 * checkout" — rendered before the first tab returned the security deposit —
 * would land as a *later* step and silently skip the one in between. Compare,
 * don't increment.
 * ------------------------------------------------------------------------- */

/** What a step submission may carry. Every amount is whole dirhams. */
export type StageSubmission = {
  /** The step being completed — must match the booking's current stage. */
  step: string;
  depositCollected?: number;
  securityCollected?: number;
  balanceCollected?: number;
  damageDeduction?: number;
  inspectionNotes?: string;
  commissionReference?: string;
};

export type StageResult =
  | { ok: true; message?: string; reviewUrl?: string }
  | { ok: false; error: string };

/**
 * Amount validation.
 *
 * Whole dirhams, never negative, and bounded well above any plausible booking
 * so a typo (or a crafted POST) cannot write an amount that breaks every total
 * it is later summed into. The ceiling is deliberately generous rather than
 * derived from the booking: an owner and a guest settling on a figure the
 * system did not quote is the normal case here — that is the entire reason
 * these columns exist — so the only thing worth rejecting is nonsense.
 */
const MAX_AMOUNT = 10_000_000;

function amount(value: unknown, fallback: number | null = null): number | null {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > MAX_AMOUNT) return null;
  return n;
}

function trimmedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > max ? null : text;
}

/** An owner completing a step on one of their own rest houses. */
export async function advanceOwnerRequestStage(
  bookingId: string,
  input: StageSubmission,
): Promise<StageResult> {
  const { t } = await getI18n();

  let ownerId: string;
  let actor: { id: string; email: string; role: string };
  try {
    const { user, owner } = await requireApprovedOwner();
    ownerId = owner.id;
    actor = { id: user.id, email: user.email, role: user.role };
  } catch (error) {
    const result = guardResult(error, t);
    return { ok: false, error: result.ok ? t.validation.unauthorized : result.error };
  }

  return applyStageAdvance(
    { id: bookingId, listing: { ownerId } },
    input,
    actor,
    "owner",
    t,
  );
}

/** The same, for an operator, on any booking. */
export async function advanceRequestStage(
  bookingId: string,
  input: StageSubmission,
): Promise<StageResult> {
  const { t } = await getI18n();

  let actor: { id: string; email: string; role: string };
  try {
    const user = await requireAdmin();
    actor = { id: user.id, email: user.email, role: user.role };
  } catch (error) {
    const result = guardResult(error, t);
    return { ok: false, error: result.ok ? t.validation.unauthorized : result.error };
  }

  return applyStageAdvance({ id: bookingId }, input, actor, "admin", t);
}

/**
 * Complete one step and move the booking to the next.
 *
 * `where` carries the caller's authorisation scope and is applied by the
 * database — an owner passing another owner's booking id gets the same "not
 * found" as for an id that never existed, which is both the right answer and
 * the one that confirms nothing about which other bookings exist.
 */
async function applyStageAdvance(
  where: Prisma.BookingRequestWhereInput,
  input: StageSubmission,
  actor: { id: string; email: string; role: string },
  scope: "admin" | "owner",
  t: Dictionary,
): Promise<StageResult> {
  if (!isBookingStage(input.step) || input.step === "DONE") {
    return { ok: false, error: t.validation.invalidStatus };
  }

  const booking = await prisma.bookingRequest.findFirst({
    where,
    select: {
      id: true,
      reference: true,
      status: true,
      stage: true,
      checkIn: true,
      checkOut: true,
      total: true,
      depositDue: true,
      securityDeposit: true,
      depositCollected: true,
      securityCollected: true,
      commissionDue: true,
      commissionSentAt: true,
      reviewInvitedAt: true,
      listingId: true,
      listing: { select: { slug: true } },
    },
  });
  if (!booking) return { ok: false, error: t.validation.requestNotFound };

  // Stale tab, or a step pressed twice. Compare rather than increment.
  if (booking.stage !== input.step) {
    return { ok: false, error: t.validation.stageNotCurrent };
  }

  const step = input.step;
  const today = todayISO();

  /* --- step 1: the deposit, which is also the confirmation ---------------- */
  if (step === "DEPOSIT") {
    if (booking.status === "CONFIRMED") {
      return { ok: false, error: t.validation.stageNotCurrent };
    }

    /**
     * An owner cannot confirm a stay that has already begun.
     *
     * Confirming writes BOOKED rows into `Availability` for every night of the
     * range, so confirming a past booking would close days that have already
     * happened — rewriting a calendar that other decisions were made against.
     * An operator can still do it: reconstructing a booking somebody took over
     * WhatsApp and never entered is exactly the sort of correction the platform
     * operator exists for, and they are accountable for it in the audit log.
     */
    if (scope === "owner" && booking.checkIn < today) {
      return { ok: false, error: t.validation.pastBookingLocked };
    }

    // Default to what was quoted, so the common case is one tap. An owner who
    // agreed something else over WhatsApp types the real figure instead — the
    // whole point of storing "collected" separately from "due".
    const depositCollected = amount(input.depositCollected, booking.depositDue);
    const securityCollected = amount(input.securityCollected, booking.securityDeposit);
    if (depositCollected === null || securityCollected === null) {
      return { ok: false, error: t.validation.amountInvalid };
    }

    const result = await applyRequestStatus(
      where,
      "CONFIRMED",
      t,
      {
        stage: "BALANCE",
        depositConfirmedAt: new Date(),
        depositCollected,
        securityCollected,
      },
      auditData({
        actor,
        action: "BOOKING_STAGE_ADVANCED",
        entityType: "BookingRequest",
        entityId: booking.id,
        summary: `${booking.reference} — ${step}`,
        metadata: { step, depositCollected, securityCollected, scope },
      }),
    );

    /**
     * The ledger entry for money the owner collected off-platform.
     *
     * Step 1 has always recorded the deposit on the booking itself
     * (`depositCollected`), and that column remains what the workflow reads —
     * nothing about the stepper changes. What is added here is a `Payment` row
     * with `provider: "MANUAL"`, so that "what has this booking been paid" has
     * ONE answer whatever route the money took: a bank transfer confirmed by an
     * owner and a card charged through Telr are two rows in the same ledger,
     * and `paymentStatus` rolls up over both.
     *
     * Deliberately outside the confirmation's transaction, and deliberately not
     * awaited into the result. The failure mode if this write does not happen
     * is that `paymentStatus` stays "NONE" on a confirmed booking — which is
     * *exactly* what this platform did before the payment tables existed, and
     * is therefore a return to the previous behaviour rather than a corruption
     * of the new one. Folding it into the transaction would mean a ledger
     * problem could refuse a confirmation the owner has already taken money
     * for, which is a far worse trade.
     *
     * Skipped entirely when nothing was collected: `assertChargeable` rejects 0,
     * and a booking with no deposit has no payment to record.
     */
    if (result.ok && depositCollected > 0) {
      await recordManualPayment({
        bookingId: booking.id,
        amount: depositCollected,
        actor,
      });
    }

    // `applyRequestStatus` already revalidated everything and reported the
    // clash case ("someone else took these nights"), so its answer is final.
    return result.ok
      ? { ok: true, message: t.workflow.stepSaved }
      : { ok: false, error: result.error };
  }

  /* --- steps 2-7 only exist inside a confirmed booking -------------------- */
  if (booking.status !== "CONFIRMED") {
    return { ok: false, error: t.validation.bookingNotConfirmed };
  }

  const data: Prisma.BookingRequestUpdateInput = { stage: nextStage(step) };
  const metadata: Record<string, unknown> = { step, scope };
  let reviewUrl: string | undefined;

  if (step === "BALANCE") {
    // What is still owed after the deposit — the figure the owner is chasing.
    const outstanding = Math.max(0, booking.total - (booking.depositCollected ?? 0));
    const balanceCollected = amount(input.balanceCollected, outstanding);
    if (balanceCollected === null) return { ok: false, error: t.validation.amountInvalid };

    data.balanceCollected = balanceCollected;
    data.balancePaidAt = new Date();
    metadata.balanceCollected = balanceCollected;
  } else if (step === "CHECKOUT") {
    data.checkedOutAt = new Date();
  } else if (step === "INSPECTION") {
    const notes = trimmedText(input.inspectionNotes ?? "", 2000);
    if (notes === null) return { ok: false, error: t.validation.amountInvalid };

    data.inspectedAt = new Date();
    data.inspectionNotes = notes || null;
    metadata.hasNotes = notes.length > 0;
  } else if (step === "SECURITY") {
    // What the owner is actually holding — the amount they recorded receiving,
    // not the amount the listing advertises. They can differ, and only the
    // first one is real money.
    const held = booking.securityCollected ?? booking.securityDeposit;
    const damageDeduction = amount(input.damageDeduction, 0);
    if (damageDeduction === null) return { ok: false, error: t.validation.amountInvalid };
    if (damageDeduction > held) {
      return { ok: false, error: t.validation.deductionTooLarge };
    }

    // Derived, never taken from the form: the returned amount and the deduction
    // must add up to what was held, and a browser that posts both can make them
    // disagree.
    data.damageDeduction = damageDeduction;
    data.securityReturned = held - damageDeduction;
    data.securityReturnedAt = new Date();
    metadata.damageDeduction = damageDeduction;
    metadata.securityReturned = held - damageDeduction;
  } else if (step === "COMMISSION") {
    /**
     * Step 6 has two halves and only the first belongs to the owner: they mark
     * the transfer as sent, and the booking STAYS at this stage until an
     * operator confirms it arrived (`confirmCommissionTransfer` below). Letting
     * "I sent it" advance the workflow on its own would make the platform's
     * only record of its own revenue a claim by the person who owes it.
     */
    // The stage does not advance on the owner's half, so this step stays
    // "current" while it waits for the operator — and would otherwise accept a
    // second submission that silently reset the sent-on date the operator is
    // about to match a bank statement against.
    if (booking.commissionSentAt) {
      return { ok: false, error: t.validation.stageNotCurrent };
    }

    const reference = trimmedText(input.commissionReference ?? "", 120);
    if (reference === null) return { ok: false, error: t.validation.amountInvalid };

    data.stage = "COMMISSION"; // deliberately not advanced
    data.commissionSentAt = new Date();
    data.commissionReference = reference || null;
    metadata.commissionDue = booking.commissionDue;

    if (scope === "admin") {
      // An operator recording it has already seen the money, so the second half
      // is redundant — they confirm in the same act.
      data.commissionConfirmedAt = new Date();
      data.stage = "REVIEW";
    }
  } else if (step === "REVIEW") {
    if (booking.reviewInvitedAt) {
      return { ok: false, error: t.validation.stageNotCurrent };
    }

    const settings = await getSettings();
    const token = generateInviteToken();
    const expiresAt = new Date(
      Date.now() + Math.max(1, settings.reviewInviteDays) * 24 * 60 * 60 * 1000,
    );

    await prisma.reviewInvite.create({
      data: { token, bookingId: booking.id, listingId: booking.listingId, expiresAt },
    });

    data.reviewInvitedAt = new Date();
    reviewUrl = reviewInviteUrl(token);
    metadata.expiresAt = expiresAt.toISOString();
  }

  await prisma.$transaction([
    prisma.bookingRequest.update({ where: { id: booking.id }, data }),
    prisma.auditLog.create({
      data: auditData({
        actor,
        action: step === "REVIEW" ? "REVIEW_INVITED" : "BOOKING_STAGE_ADVANCED",
        entityType: "BookingRequest",
        entityId: booking.id,
        summary: `${booking.reference} — ${step}`,
        metadata,
      }),
    }),
  ]);

  revalidateBookingViews(booking.listing.slug);

  return { ok: true, message: t.workflow.stepSaved, reviewUrl };
}

/**
 * The operator half of step 6 — confirming the commission actually landed.
 *
 * Admin-only by construction, and the reason is the whole point of the step:
 * the owner has already said they sent it. A second "yes" from the same person
 * would confirm nothing.
 */
export async function confirmCommissionTransfer(bookingId: string): Promise<StageResult> {
  const { t } = await getI18n();

  let actor: { id: string; email: string; role: string };
  try {
    const user = await requireAdmin();
    actor = { id: user.id, email: user.email, role: user.role };
  } catch (error) {
    const result = guardResult(error, t);
    return { ok: false, error: result.ok ? t.validation.unauthorized : result.error };
  }

  const booking = await prisma.bookingRequest.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      reference: true,
      stage: true,
      commissionDue: true,
      commissionSentAt: true,
      commissionConfirmedAt: true,
      listing: { select: { slug: true } },
    },
  });
  if (!booking) return { ok: false, error: t.validation.requestNotFound };
  if (booking.stage !== "COMMISSION" || booking.commissionConfirmedAt) {
    return { ok: false, error: t.validation.stageNotCurrent };
  }
  if (!booking.commissionSentAt) {
    return { ok: false, error: t.validation.commissionNotSent };
  }

  await prisma.$transaction([
    prisma.bookingRequest.update({
      where: { id: booking.id },
      data: { commissionConfirmedAt: new Date(), stage: "REVIEW" },
    }),
    prisma.auditLog.create({
      data: auditData({
        actor,
        action: "BOOKING_COMMISSION_CONFIRMED",
        entityType: "BookingRequest",
        entityId: booking.id,
        summary: booking.reference,
        metadata: { commissionDue: booking.commissionDue },
      }),
    }),
  ]);

  revalidateBookingViews(booking.listing.slug);

  return { ok: true, message: t.workflow.commissionConfirmed };
}

/**
 * Step back one stage — admin only.
 *
 * A mis-tap on "the guest has checked out" is otherwise unrecoverable: the
 * workflow only moves forward, and the alternative would be cancelling a live
 * booking to reset it, which frees dates that are still occupied. Reverting
 * clears the columns that step wrote, so the step is genuinely undone rather
 * than merely re-offered with stale amounts already filled in.
 *
 * Step 1 is not revertible here on purpose: undoing a confirmation is
 * "cancel the booking", which has to release the calendar and decrement the
 * listing's counter — that is `setRequestStatus(id, "CANCELLED")`, and having
 * two ways to do it is how the two drift apart.
 */
export async function revertRequestStage(bookingId: string): Promise<StageResult> {
  const { t } = await getI18n();

  let actor: { id: string; email: string; role: string };
  try {
    const user = await requireAdmin();
    actor = { id: user.id, email: user.email, role: user.role };
  } catch (error) {
    const result = guardResult(error, t);
    return { ok: false, error: result.ok ? t.validation.unauthorized : result.error };
  }

  const booking = await prisma.bookingRequest.findUnique({
    where: { id: bookingId },
    select: { id: true, reference: true, stage: true, listing: { select: { slug: true } } },
  });
  if (!booking) return { ok: false, error: t.validation.requestNotFound };

  const index = BOOKING_STAGES.indexOf(booking.stage as BookingStage);
  if (index <= 1) return { ok: false, error: t.validation.cannotRevertStage };

  const previous = BOOKING_STAGES[index - 1];

  // Clearing what the step recorded is what makes this an undo rather than a
  // rewind: leaving `balanceCollected` behind would show the next attempt an
  // amount somebody has already been told was received.
  const cleared: Prisma.BookingRequestUpdateInput = { stage: previous };
  if (previous === "BALANCE") {
    cleared.balanceCollected = null;
    cleared.balancePaidAt = null;
  } else if (previous === "CHECKOUT") {
    cleared.checkedOutAt = null;
  } else if (previous === "INSPECTION") {
    cleared.inspectedAt = null;
    cleared.inspectionNotes = null;
  } else if (previous === "SECURITY") {
    cleared.damageDeduction = null;
    cleared.securityReturned = null;
    cleared.securityReturnedAt = null;
  } else if (previous === "COMMISSION") {
    cleared.commissionSentAt = null;
    cleared.commissionConfirmedAt = null;
    cleared.commissionReference = null;
  } else if (previous === "REVIEW") {
    // The invite has to go with the timestamp. Leaving the row behind puts the
    // booking back on a step that refuses to run — `applyStageAdvance` bails on
    // `reviewInvitedAt`, and once the guest spends the old link the card offers
    // a "create link" button that can only ever fail.
    cleared.reviewInvitedAt = null;
  }

  await prisma.$transaction([
    prisma.bookingRequest.update({ where: { id: booking.id }, data: cleared }),
    // deleteMany, not delete: a booking that never reached step 7 has no invite
    // to remove, and `delete` would abort the whole transaction over its
    // absence.
    ...(previous === "REVIEW"
      ? [prisma.reviewInvite.deleteMany({ where: { bookingId: booking.id } })]
      : []),
    prisma.auditLog.create({
      data: auditData({
        actor,
        action: "BOOKING_STAGE_REVERTED",
        entityType: "BookingRequest",
        entityId: booking.id,
        summary: `${booking.reference} — ${booking.stage} → ${previous}`,
        metadata: { from: booking.stage, to: previous },
      }),
    }),
  ]);

  revalidateBookingViews(booking.listing.slug);

  return { ok: true, message: t.workflow.stepReverted };
}

/**
 * Both dashboards, every time.
 *
 * A step completed by an owner still changes what the operator's queue shows —
 * the commission list in particular is built from exactly these columns — and
 * revalidating a path nobody is looking at costs nothing, while missing one
 * leaves a stale card that somebody presses a second time.
 */
function revalidateBookingViews(listingSlug: string): void {
  revalidatePath("/admin");
  revalidatePath("/admin/requests");
  revalidatePath("/admin/payments");
  revalidatePath("/admin/calendar");
  revalidatePath("/owner");
  revalidatePath("/owner/bookings");
  revalidatePath(`/listings/${listingSlug}`);
  revalidatePath("/listings");
}
