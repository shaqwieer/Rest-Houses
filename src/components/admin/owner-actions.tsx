"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { phoneFieldProps } from "@/components/ui/phone-input";
import {
  approveOwner,
  rejectOwner,
  setOwnerMembershipExpiry,
  setOwnerPassword,
  setOwnerSuspended,
  updateOwnerAccount,
} from "@/app/actions/owners";
import { useLocale } from "@/lib/i18n/provider";
import { CITIES, label as pickLabel, type OwnerAccessState } from "@/lib/constants";

/** The owner's editable details, as they stand right now. */
export type OwnerAccount = {
  fullName: string;
  businessName: string;
  email: string;
  phone: string;
  whatsapp: string;
  /** A CITIES id, or "". */
  city: string;
  idNumber: string;
  about: string;
};

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
  account,
}: {
  ownerId: string;
  state: OwnerAccessState;
  /** ISO "YYYY-MM-DD", or null. */
  membershipExpiresAt: string | null;
  /** Current details, used to pre-fill the manage dialog. */
  account: OwnerAccount;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { t, locale } = useLocale();
  const [pending, startTransition] = useTransition();

  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [editingExpiry, setEditingExpiry] = useState(false);
  const [expiry, setExpiry] = useState(membershipExpiresAt ?? "");

  const [managing, setManaging] = useState(false);
  const [tab, setTab] = useState<"details" | "password">("details");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  type Result = {
    ok: boolean;
    message?: string;
    error?: string;
    fieldErrors?: Record<string, string>;
  };

  function run(fn: () => Promise<Result>) {
    startTransition(async () => {
      const result = await fn();
      toast(
        result.ok ? (result.message ?? t.common.saved) : (result.error ?? t.common.error),
        result.ok ? "ok" : "error",
      );
      // Kept on failure so a rejected save shows *which* field was wrong
      // instead of only a toast that disappears.
      setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
      if (result.ok) {
        setRejecting(false);
        setEditingExpiry(false);
        setManaging(false);
        // Never left sitting in component state after a successful change.
        setPassword("");
        setConfirmPassword("");
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

      {/* Account management — details and password. Offered for every state,
          including a rejected or suspended owner: fixing a mistyped email or
          issuing a new password is exactly what an operator needs to do for an
          account that is currently switched off. */}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setErrors({});
          setTab("details");
          setManaging(true);
        }}
        title={t.admin.manageOwner}
        aria-label={t.admin.manageOwner}
        className="grid size-8 place-items-center rounded-lg border border-line bg-surface text-ink transition hover:border-gold-500 disabled:opacity-60"
      >
        <Icon name="badge" size={16} />
      </button>

      {/* ---- reject, with an optional reason ---- */}
      <Dialog open={rejecting} onClose={() => setRejecting(false)} label={t.admin.reject}>
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
      </Dialog>

      {/* ---- manage account: details + password ---- */}
      <Dialog open={managing} onClose={() => setManaging(false)} label={t.admin.manageOwnerTitle} wide>
          <h2 className="m-0 mb-3 font-display text-[16px] font-extrabold text-ink">
            {t.admin.manageOwnerTitle}
          </h2>

          <div className="mb-4 flex gap-1.5 rounded-xl bg-sand-100 p-1">
            <TabButton
              active={tab === "details"}
              onClick={() => setTab("details")}
              label={t.admin.ownerDetailsTab}
            />
            <TabButton
              active={tab === "password"}
              onClick={() => setTab("password")}
              label={t.admin.ownerPasswordTab}
            />
          </div>

          {tab === "details" ? (
            /* An uncontrolled form: the inputs start from the row already on
               screen and the action reads a FormData, so nothing here has to
               mirror the owner's record in React state.

               ─── The `key` is load-bearing ─────────────────────────────────
               Both tabs render a <form> at this same position, so without
               distinct keys React reconciles one into the other instead of
               remounting: field 1 and field 2 of this form become the two
               password inputs and back again. That flips them between
               uncontrolled (`defaultValue`) and controlled (`value`) — the
               console warning — and, worse, `defaultValue` only applies on
               mount, so returning to this tab left the name and business name
               showing the empty password state. Saving then wrote those blanks
               over the owner's real details. */
            <form
              key="details"
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                run(() => updateOwnerAccount(ownerId, formData));
              }}
              className="flex flex-col gap-3"
            >
              <ModalField label={t.owner.fullName} error={errors.fullName}>
                <input
                  name="fullName"
                  defaultValue={account.fullName}
                  required
                  className={inputClass}
                />
              </ModalField>

              <ModalField label={t.owner.businessName} error={errors.businessName}>
                <input
                  name="businessName"
                  defaultValue={account.businessName}
                  className={inputClass}
                />
              </ModalField>

              <ModalField label={t.owner.email} error={errors.email}>
                <input
                  name="email"
                  type="email"
                  dir="ltr"
                  defaultValue={account.email}
                  required
                  className={inputClass}
                />
              </ModalField>

              <div className="grid gap-3 sm:grid-cols-2">
                {/* This number is the owner's username. Editing it here moves
                    their login with it — see `updateOwnerAccount`. */}
                <ModalField
                  label={t.owner.phone}
                  error={errors.phone}
                  hint={t.owner.phoneIsUsernameHint}
                >
                  <input
                    name="phone"
                    required
                    className={inputClass}
                    {...phoneFieldProps(account.phone)}
                  />
                </ModalField>

                <ModalField label={t.owner.whatsapp} error={errors.whatsapp}>
                  <input
                    name="whatsapp"
                    required
                    className={inputClass}
                    {...phoneFieldProps(account.whatsapp)}
                  />
                </ModalField>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <ModalField label={t.listings.city} error={errors.city}>
                  <select
                    name="city"
                    defaultValue={account.city}
                    className={inputClass}
                  >
                    <option value="">{t.admin.ownerNoCity}</option>
                    {CITIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {pickLabel(c, locale)}
                      </option>
                    ))}
                  </select>
                </ModalField>

                <ModalField
                  label={t.admin.ownerIdNumberLabel}
                  error={errors.idNumber}
                >
                  <input
                    name="idNumber"
                    dir="ltr"
                    defaultValue={account.idNumber}
                    className={inputClass}
                  />
                </ModalField>
              </div>

              <ModalField label={t.admin.ownerAboutLabel} error={errors.about}>
                <textarea
                  name="about"
                  rows={3}
                  defaultValue={account.about}
                  className={`${inputClass} resize-y`}
                />
              </ModalField>

              <div className="mt-1 flex gap-2.5">
                <button
                  type="submit"
                  disabled={pending}
                  className="flex-1 rounded-2xl bg-night-900 p-3 text-[14px] font-bold text-sand-50 disabled:opacity-60"
                >
                  {pending ? t.common.saving : t.common.save}
                </button>
                <button
                  type="button"
                  onClick={() => setManaging(false)}
                  className="rounded-2xl border border-line bg-surface px-5 py-3 text-[14px] font-bold text-ink"
                >
                  {t.common.cancel}
                </button>
              </div>
            </form>
          ) : (
            <form
              key="password"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => setOwnerPassword(ownerId, password, confirmPassword));
              }}
              className="flex flex-col gap-3"
            >
              <ModalField label={t.admin.newPassword} error={errors.password}>
                <input
                  type="password"
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                  // The browser must not offer to fill or save this: it is
                  // someone else's credential being set, not the admin's own.
                  autoComplete="new-password"
                  className={inputClass}
                />
              </ModalField>

              <ModalField
                label={t.admin.confirmNewPassword}
                error={errors.confirmPassword}
              >
                <input
                  type="password"
                  dir="ltr"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={8}
                  required
                  autoComplete="new-password"
                  className={inputClass}
                />
              </ModalField>

              <p className="m-0 text-[11.5px] leading-relaxed text-muted">
                {t.admin.newPasswordHint}
              </p>

              <div className="mt-1 flex gap-2.5">
                <button
                  type="submit"
                  disabled={pending}
                  className="flex-1 rounded-2xl bg-night-900 p-3 text-[14px] font-bold text-sand-50 disabled:opacity-60"
                >
                  {pending ? t.common.saving : t.admin.changePassword}
                </button>
                <button
                  type="button"
                  onClick={() => setManaging(false)}
                  className="rounded-2xl border border-line bg-surface px-5 py-3 text-[14px] font-bold text-ink"
                >
                  {t.common.cancel}
                </button>
              </div>
            </form>
          )}
      </Dialog>

      {/* ---- membership expiry ---- */}
      <Dialog
        open={editingExpiry}
        onClose={() => setEditingExpiry(false)}
        label={t.admin.setExpiry}
      >
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
      </Dialog>
    </div>
  );
}

/** Shared input styling — the same box as the rest of the admin forms. */
const inputClass =
  "w-full rounded-[13px] border border-line bg-sand-50 px-3.5 py-2.5 text-[14px] " +
  "text-ink outline-none focus:border-gold-500 focus:bg-surface";

/** One labelled row of the manage dialog, with room for a field error. */
function ModalField({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-bold text-bronze">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11.5px] text-busy">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11.5px] text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-bold transition ${
        active ? "bg-surface text-ink shadow-e1" : "text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

/* The local `Modal` that used to live here is now `Dialog` in
   src/components/ui/dialog.tsx — same markup, same `wide` behaviour, but drawn
   through a portal so no ancestor's `transform` can capture it. Its reasoning
   about `self-start` moved across with it. */
