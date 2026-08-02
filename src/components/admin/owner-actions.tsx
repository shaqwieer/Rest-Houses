"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import {
  approveOwner,
  rejectOwner,
  setOwnerMembershipExpiry,
  setOwnerSuspended,
} from "@/app/actions/owners";
import { useLocale } from "@/lib/i18n/provider";
import type { OwnerAccessState } from "@/lib/constants";

/**
 * Approve / reject / suspend / activate / set-expiry controls for one owner.
 *
 * Every one of these calls a server action that re-checks `requireAdmin()`.
 * Which buttons render here is a matter of what makes sense to offer, never of
 * what the caller is permitted to do — a non-admin who replayed any of these
 * action ids would still be refused server-side.
 */
export function OwnerActions({
  ownerId,
  state,
  membershipExpiresAt,
}: {
  ownerId: string;
  state: OwnerAccessState;
  /** ISO "YYYY-MM-DD", or null. */
  membershipExpiresAt: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useLocale();
  const [pending, startTransition] = useTransition();

  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [editingExpiry, setEditingExpiry] = useState(false);
  const [expiry, setExpiry] = useState(membershipExpiresAt ?? "");

  function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    startTransition(async () => {
      const result = await fn();
      toast(
        result.ok ? (result.message ?? t.common.saved) : (result.error ?? t.common.error),
        result.ok ? "ok" : "error",
      );
      if (result.ok) {
        setRejecting(false);
        setEditingExpiry(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(state === "PENDING" || state === "REJECTED") && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => approveOwner(ownerId))}
          className="rounded-lg bg-ok px-3 py-1.5 text-[12px] font-bold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {t.admin.approve}
        </button>
      )}

      {state !== "REJECTED" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => setRejecting(true)}
          className="rounded-lg bg-busy-bg px-3 py-1.5 text-[12px] font-bold text-busy transition hover:bg-[#f0d2cc] disabled:opacity-60"
        >
          {t.admin.reject}
        </button>
      )}

      {(state === "APPROVED" || state === "EXPIRED") && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setOwnerSuspended(ownerId, true))}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-bold text-ink transition hover:border-busy hover:text-busy disabled:opacity-60"
        >
          {t.admin.suspend}
        </button>
      )}

      {state === "SUSPENDED" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => setOwnerSuspended(ownerId, false))}
          className="rounded-lg bg-ok px-3 py-1.5 text-[12px] font-bold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {t.admin.activate}
        </button>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={() => setEditingExpiry(true)}
        title={t.admin.setExpiry}
        aria-label={t.admin.setExpiry}
        className="grid size-8 place-items-center rounded-lg border border-line bg-surface text-ink transition hover:border-gold-500 disabled:opacity-60"
      >
        <Icon name="event_repeat" size={16} />
      </button>

      {/* ---- reject, with an optional reason ---- */}
      {rejecting && (
        <Modal onClose={() => setRejecting(false)}>
          <h2 className="m-0 mb-3 font-display text-[16px] font-extrabold text-ink">
            {t.admin.reject}
          </h2>
          <label className="mb-1.5 block text-[12.5px] font-bold text-bronze">
            {t.admin.rejectionReasonLabel}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={t.admin.rejectionReasonPlaceholder}
            className="mb-4 w-full resize-y rounded-[13px] border border-line bg-sand-50 px-3.5 py-3 text-[14px] leading-[1.8] text-ink outline-none focus:border-gold-500 focus:bg-surface"
          />
          <div className="flex gap-2.5">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => rejectOwner(ownerId, reason))}
              className="flex-1 rounded-2xl bg-busy p-3 text-[14px] font-bold text-white disabled:opacity-60"
            >
              {t.admin.confirmReject}
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="rounded-2xl border border-line bg-surface px-5 py-3 text-[14px] font-bold text-ink"
            >
              {t.common.cancel}
            </button>
          </div>
        </Modal>
      )}

      {/* ---- membership expiry ---- */}
      {editingExpiry && (
        <Modal onClose={() => setEditingExpiry(false)}>
          <h2 className="m-0 mb-3 font-display text-[16px] font-extrabold text-ink">
            {t.admin.setExpiry}
          </h2>
          <label className="mb-1.5 block text-[12.5px] font-bold text-bronze">
            {t.admin.membershipExpiresAt}
          </label>
          <input
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            dir="ltr"
            className="mb-2 w-full rounded-[13px] border border-line bg-sand-50 px-3.5 py-3 text-[14px] text-ink outline-none focus:border-gold-500 focus:bg-surface"
          />
          <p className="m-0 mb-4 text-[11.5px] text-muted">{t.admin.expiryHint}</p>
          <div className="flex gap-2.5">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setOwnerMembershipExpiry(ownerId, expiry))}
              className="flex-1 rounded-2xl bg-night-900 p-3 text-[14px] font-bold text-sand-50 disabled:opacity-60"
            >
              {t.common.save}
            </button>
            <button
              type="button"
              onClick={() => setEditingExpiry(false)}
              className="rounded-2xl border border-line bg-surface px-5 py-3 text-[14px] font-bold text-ink"
            >
              {t.common.cancel}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-300 grid place-items-center bg-night-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-pop-in w-full max-w-100 rounded-[24px] border border-line bg-surface p-5 text-start shadow-e2"
        // Stops a click inside the dialog from reaching the backdrop's handler
        // and closing it — a half-typed rejection reason should survive a
        // stray click on the textarea.
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
