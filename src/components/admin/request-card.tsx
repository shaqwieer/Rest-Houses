"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import {
  deleteRequest,
  setOwnerRequestStatus,
  setRequestStatus,
} from "@/app/actions/requests";
import { BookingWorkflow, type WorkflowBooking } from "@/components/admin/booking-workflow";
import type { BankDetails } from "@/components/admin/bank-details";
import { arDayMonth, todayISO } from "@/lib/dates";
import { arNum, formatReference } from "@/lib/format";
import { useLocale } from "@/lib/i18n/provider";

export type RequestCardData = {
  id: string;
  reference: string;
  listingName: string;
  listingSlug: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  /** A day booking (حجز بدون مبيت): one day, `checkOut === checkIn`, 0 nights. */
  dayUse: boolean;
  guests: number;
  total: number;
  depositDue: number;
  /** The rate snapshotted on the booking — not the listing's current one. */
  depositPercent: number;
  notes: string | null;
  status: string;
  /** Pre-built wa.me link with the owner's reply pre-typed. */
  whatsappHref: string;
  /**
   * Everything the handover stepper needs, or null on a surface that only
   * wants to display the request (the read-only views).
   */
  workflow: WorkflowBooking | null;
};

/**
 * One booking request, with confirm / reject / WhatsApp / delete actions.
 *
 * `scope` decides which server action the buttons call, not whether they
 * appear. An owner answers requests for their own rest houses — they are the
 * person the guest is actually dealing with, and a booking that waits for an
 * operator to press "confirm" goes cold. `setOwnerRequestStatus` scopes the
 * update to that owner's own listings in the WHERE clause.
 *
 * Deleting stays admin-only, which is why the delete control is the one thing
 * still hidden by scope: rejecting a request already tells the guest what they
 * need to know, while erasing the row destroys the operator's record of it.
 *
 * `readOnly` remains for any surface that wants to show a request without
 * offering to change it.
 */
export function RequestCard({
  request,
  readOnly = false,
  scope = "admin",
  reviewInviteDays = 15,
  bank,
}: {
  request: RequestCardData;
  readOnly?: boolean;
  scope?: "admin" | "owner";
  /** Passed to the stepper so step 7 states the configured link validity. */
  reviewInviteDays?: number;
  /** Passed to the stepper so step 6 shows where to send the commission. */
  bank?: BankDetails | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { t, locale } = useLocale();
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isOwner = scope === "owner";

  function act(status: string) {
    startTransition(async () => {
      const result = isOwner
        ? await setOwnerRequestStatus(request.id, status)
        : await setRequestStatus(request.id, status);
      toast(result.ok ? (result.message ?? t.common.saved) : result.error, result.ok ? "ok" : "error");
      if (result.ok) router.refresh();
    });
  }

  function onDelete() {
    startTransition(async () => {
      const result = await deleteRequest(request.id);
      toast(result.ok ? (result.message ?? t.common.saved) : result.error, result.ok ? "ok" : "error");
      setConfirmingDelete(false);
      if (result.ok) router.refresh();
    });
  }

  const isNew = request.status === "NEW";
  const isConfirmed = request.status === "CONFIRMED";

  // Mirrors the server-side rule in `setOwnerRequestStatus` — the guard that
  // matters is there; this one only stops the owner pressing a button that was
  // always going to be refused.
  const cancelLocked = isOwner && request.checkIn <= todayISO();

  return (
    // `min-w-0` because this is a grid item, and a grid item's default
    // `min-width: auto` resolves to its min-content width — so any one wide
    // thing inside can push the track, the card and the page past the screen.
    //
    // It is a guard, not the cure. What actually broke this card on a phone was
    // the review link inside the stepper: `white-space: nowrap` gave that line
    // a min-content width of the whole URL, and no amount of `min-w-0` on the
    // ancestors reduces a descendant's own min-content. That is fixed at source
    // in `ReviewLinkBox` — see the note there. This stays because the card also
    // carries emails and long rest-house names, and a grid item that can shrink
    // is the correct default regardless.
    //
    // `overflow-hidden` clips anything that still overshoots rather than
    // letting it escape the rounded border.
    <div className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-[20px] border border-line bg-surface p-4 shadow-e1">
      {/* header */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <div className="font-display text-[15px] font-bold text-ink">{request.customerName}</div>
          <div className="mt-0.5 truncate text-[12px] text-muted">
            <span dir="ltr">{formatReference(request.reference, locale)}</span> ·{" "}
            <Link
              href={`/listings/${encodeURIComponent(request.listingSlug)}`}
              target="_blank"
              className="text-muted no-underline hover:text-bronze hover:no-underline"
            >
              {request.listingName}
            </Link>
          </div>
        </div>
        <StatusBadge status={request.status} />
      </div>

      {/* facts */}
      <div className="grid grid-cols-3 gap-2">
        {/* A day booking is one date. Rendering "28 July – 28 July" here would
            leave an owner scanning their queue unable to tell it apart from a
            stay, which changes what they have to prepare. */}
        <Cell
          label={request.dayUse ? t.listing.stayDayUse : t.listing.dates}
          value={
            request.dayUse
              ? arDayMonth(request.checkIn, locale)
              : `${arDayMonth(request.checkIn, locale)} – ${arDayMonth(request.checkOut, locale)}`
          }
        />
        <Cell label={t.listing.guests} value={arNum(request.guests, locale)} />
        <Cell
          label={t.listing.total}
          value={`${arNum(request.total, locale)} ${t.common.aed}`}
        />
      </div>

      {/* contact — tappable on a phone, which is the point */}
      <div className="flex flex-wrap gap-3 text-[12.5px]">
        <a
          href={`tel:${request.customerPhone}`}
          dir="ltr"
          className="flex items-center gap-1.5 font-semibold text-bronze no-underline hover:no-underline"
        >
          <Icon name="call" size={15} />
          {request.customerPhone}
        </a>
        {request.customerEmail && (
          <a
            href={`mailto:${request.customerEmail}`}
            dir="ltr"
            className="flex items-center gap-1.5 text-muted no-underline hover:text-bronze hover:no-underline"
          >
            <Icon name="mail" size={15} />
            {request.customerEmail}
          </a>
        )}
      </div>

      {request.notes && (
        <p className="m-0 rounded-xl bg-gold-100 px-3 py-2.5 text-[12.5px] leading-relaxed text-bronze">
          {request.notes}
        </p>
      )}

      {isConfirmed && (
        <p className="m-0 flex items-center gap-2 rounded-xl bg-ok-bg px-3 py-2.5 text-[12px] font-semibold text-ok">
          <Icon name="event_available" size={16} />
          {t.admin.datesBooked}
        </p>
      )}

      {/*
        The handover, in place of what used to be a bare "confirm" button.
        Confirming is now step 1 of seven, so the money it records — and every
        step that follows it — lives here rather than in a status line that
        stated the deposit and then stopped.
      */}
      {!readOnly && request.workflow && (
        <BookingWorkflow
          booking={request.workflow}
          scope={scope}
          reviewInviteDays={reviewInviteDays}
          bank={bank}
        />
      )}

      {/* actions */}
      <div className="flex items-center gap-2">
        <a
          href={request.whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          title={t.admin.messageCustomer}
          aria-label={t.admin.messageCustomer}
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-wa text-wa-ink no-underline transition hover:brightness-105 hover:no-underline"
        >
          <Icon name="chat" size={20} />
        </a>

        {!readOnly && isNew && (
          <button
            type="button"
            onClick={() => act("REJECTED")}
            disabled={pending}
            className="flex-1 rounded-xl bg-busy-bg p-3 text-[13.5px] font-bold text-busy transition hover:bg-[#f0d2cc] disabled:opacity-60"
          >
            {t.admin.reject}
          </button>
        )}

        {!readOnly && isConfirmed && (
          /*
           * An owner cannot cancel a stay that has already started.
           *
           * Cancelling deletes the BOOKED rows for every night of the range, so
           * doing it to a past booking rewrites a calendar that other decisions
           * were already made against — and it would take the platform's
           * commission on a completed stay with it. An operator can still do
           * it; they are accountable for it in the audit log.
           */
          <button
            type="button"
            onClick={() => act("CANCELLED")}
            disabled={pending || cancelLocked}
            title={cancelLocked ? t.validation.pastBookingLocked : undefined}
            className="flex-1 rounded-xl border border-line bg-surface p-3 text-[13px] font-bold text-ink transition hover:border-busy hover:text-busy disabled:cursor-not-allowed disabled:opacity-45"
          >
            {t.admin.cancelBookingFreeDates}
          </button>
        )}

        {!readOnly && !isNew && !isConfirmed && (
          <button
            type="button"
            onClick={() => act("NEW")}
            disabled={pending}
            className="flex-1 rounded-xl border border-line bg-surface p-3 text-[13px] font-bold text-ink transition hover:border-gold-500 disabled:opacity-60"
          >
            {t.admin.returnToQueue}
          </button>
        )}

        {!readOnly && !isOwner && (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={pending}
            title={t.admin.deleteRequest}
            aria-label={t.admin.deleteRequest}
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-busy-bg text-busy disabled:opacity-60"
          >
            <Icon name="delete" size={18} />
          </button>
        )}
      </div>

      {confirmingDelete && (
        <div className="fixed inset-0 z-300 grid place-items-center bg-night-900/60 p-4 backdrop-blur-sm">
          <div className="animate-pop-in w-full max-w-90 rounded-[24px] border border-line bg-surface p-5 shadow-e2">
            <h2 className="m-0 mb-2 text-center font-display text-[16px] font-extrabold text-ink">
              {t.admin.deleteRequest}{" "}
              <span dir="ltr">{formatReference(request.reference, locale)}</span>
            </h2>
            <p className="m-0 mb-4 text-center text-[13px] text-muted">
              {t.admin.cannotBeUndone}
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={onDelete}
                disabled={pending}
                className="flex-1 rounded-2xl bg-busy p-3.5 text-[14px] font-bold text-white disabled:opacity-60"
              >
                {t.common.delete}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-2xl border border-line bg-surface px-5 py-3.5 text-[14px] font-bold text-ink"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-sand-50 px-2.5 py-2">
      <span className="mb-0.5 block text-[10.5px] text-muted">{label}</span>
      <span className="block text-[12.5px] font-bold text-ink">{value}</span>
    </div>
  );
}
