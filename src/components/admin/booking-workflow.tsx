"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import type { IconName } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import { BankDetailsPanel, hasBankDetails, type BankDetails } from "./bank-details";
import {
  advanceOwnerRequestStage,
  advanceRequestStage,
  confirmCommissionTransfer,
  revertRequestStage,
  type StageSubmission,
} from "@/app/actions/requests";
import {
  BOOKING_STAGES,
  isStageComplete,
  stageNumber,
  WORKFLOW_STAGES,
  type BookingStage,
} from "@/lib/constants";
import { arDayMonth, formatInstant } from "@/lib/dates";
import { arNum } from "@/lib/format";
import { useLocale } from "@/lib/i18n/provider";
import { whatsappLink } from "@/lib/whatsapp";

/**
 * The booking handover, drawn as the flow it is.
 *
 * ─── Why a stepper and not a row of buttons ─────────────────────────────────
 * The old card offered "confirm" and "reject" and then went quiet. Everything
 * that actually goes wrong in this business happens after that point: a balance
 * nobody chased on arrival day, a security deposit nobody gave back, a
 * commission nobody remitted, a guest nobody asked for a review. None of those
 * were anywhere in the interface, so none of them were anybody's job.
 *
 * So the card shows the whole sequence at once — done, current, and still to
 * come — and only ever offers ONE button. An owner who has never run a booking
 * properly can read the panel top to bottom and see what running one properly
 * consists of. That is the feature; the buttons are incidental.
 *
 * ─── One open step at a time ────────────────────────────────────────────────
 * Completed steps collapse to a line stating what was recorded (the amount, the
 * date). Future steps are visible but inert — deliberately visible, because a
 * step you cannot see is a step you cannot plan for, and the owner needs to
 * know on day one that they will be asked to return the security deposit.
 */

export type WorkflowBooking = {
  id: string;
  reference: string;
  status: string;
  stage: string;
  checkIn: string;
  checkOut: string;
  customerName: string;
  customerPhone: string;
  listingName: string;

  total: number;
  depositDue: number;
  securityDeposit: number;
  commissionDue: number;
  commissionPercent: number;

  depositCollected: number | null;
  securityCollected: number | null;
  balanceCollected: number | null;
  damageDeduction: number | null;
  securityReturned: number | null;
  inspectionNotes: string | null;
  commissionReference: string | null;

  depositConfirmedAt: Date | null;
  balancePaidAt: Date | null;
  checkedOutAt: Date | null;
  inspectedAt: Date | null;
  securityReturnedAt: Date | null;
  commissionSentAt: Date | null;
  commissionConfirmedAt: Date | null;
  reviewInvitedAt: Date | null;

  /** Present once step 7 has issued a link. */
  reviewInviteUrl: string | null;
  reviewInviteExpiresAt: Date | null;
  /** The moderation state of the review the guest left, if they left one. */
  reviewStatus: string | null;
};

const STEP_ICONS: Record<string, IconName> = {
  DEPOSIT: "savings",
  BALANCE: "payments",
  CHECKOUT: "logout",
  INSPECTION: "shield",
  SECURITY: "swap_vert",
  COMMISSION: "receipt_long",
  REVIEW: "rate_review",
};

export function BookingWorkflow({
  booking,
  scope,
  reviewInviteDays,
  bank,
}: {
  booking: WorkflowBooking;
  scope: "admin" | "owner";
  /** From site settings, so step 7 states the real validity rather than "15". */
  reviewInviteDays: number;
  /**
   * The platform's bank account, also from site settings, so step 6 can tell
   * the owner where to send the commission it is asking them to transfer.
   * Blank fields render nothing at all — see `BankDetailsPanel`.
   */
  bank?: BankDetails | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { t, locale } = useLocale();
  const [pending, startTransition] = useTransition();

  // The link the last "create review link" returned. Held in state as well as
  // read from the booking so the owner sees it the instant it exists, without
  // waiting for the router refresh that follows.
  const [freshLink, setFreshLink] = useState<string | null>(null);

  const isOwner = scope === "owner";
  const money = (n: number) => `${arNum(n, locale)} ${t.common.aed}`;
  const percent = (n: number) => `${arNum(n, locale)}${locale === "ar" ? "٪" : "%"}`;

  const stage = booking.stage as BookingStage;
  const isConfirmed = booking.status === "CONFIRMED";
  const isClosed = booking.status === "REJECTED" || booking.status === "CANCELLED";
  const reviewUrl = freshLink ?? booking.reviewInviteUrl;

  function submit(input: StageSubmission) {
    startTransition(async () => {
      const result = isOwner
        ? await advanceOwnerRequestStage(booking.id, input)
        : await advanceRequestStage(booking.id, input);

      toast(
        result.ok ? (result.message ?? t.common.saved) : result.error,
        result.ok ? "ok" : "error",
      );
      if (result.ok) {
        if (result.reviewUrl) setFreshLink(result.reviewUrl);
        router.refresh();
      }
    });
  }

  function onConfirmCommission() {
    startTransition(async () => {
      const result = await confirmCommissionTransfer(booking.id);
      toast(
        result.ok ? (result.message ?? t.common.saved) : result.error,
        result.ok ? "ok" : "error",
      );
      if (result.ok) router.refresh();
    });
  }

  function onRevert() {
    startTransition(async () => {
      const result = await revertRequestStage(booking.id);
      toast(
        result.ok ? (result.message ?? t.common.saved) : result.error,
        result.ok ? "ok" : "error",
      );
      if (result.ok) router.refresh();
    });
  }

  // A rejected or cancelled request has no workflow to show: nothing was
  // collected and nothing is owed. Showing seven greyed-out steps on it would
  // be noise on the one card that needs none.
  if (isClosed) return null;

  const total = WORKFLOW_STAGES.length;

  return (
    // `min-w-0` for the same reason as on the card that contains this — a
    // shrinkable box is the right default for a panel full of amounts,
    // references and links. See the note on `RequestCard`'s root for why it is
    // a guard rather than the fix for the overflow that was reported.
    <div className="min-w-0 rounded-[18px] border border-line bg-sand-50 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-display text-[13.5px] font-extrabold text-ink">
          <Icon name="task_alt" size={17} className="text-gold-600" />
          {t.workflow.title}
        </span>
        <span className="text-[11.5px] font-semibold text-muted">
          {stage === "DONE"
            ? t.workflow.completed
            : t.workflow.stepOf(
                arNum(stageNumber(stage), locale),
                arNum(total, locale),
              )}
        </span>
      </div>

      <ol className="m-0 flex list-none flex-col gap-0 p-0">
        {WORKFLOW_STAGES.map((step, index) => {
          const done = isStageComplete(booking.stage, step);
          // Step 1 is "current" for a request nobody has answered yet, which is
          // the only stage that exists outside a confirmed booking.
          const current = booking.stage === step && (isConfirmed || step === "DEPOSIT");
          const last = index === WORKFLOW_STAGES.length - 1;

          return (
            <li key={step} className="relative flex gap-3">
              {/* rail */}
              <div className="flex flex-col items-center">
                <span
                  className={clsx(
                    "grid size-8 shrink-0 place-items-center rounded-full border-2 text-[12px] font-extrabold transition",
                    done && "border-ok bg-ok text-white",
                    current && !done && "border-gold-600 bg-gold-100 text-bronze",
                    !done && !current && "border-line bg-surface text-off",
                  )}
                >
                  {done ? (
                    <Icon name="check" size={16} />
                  ) : (
                    <Icon name={STEP_ICONS[step]} size={15} />
                  )}
                </span>
                {!last && (
                  <span
                    className={clsx(
                      "w-0.5 flex-1 rounded-full",
                      done ? "bg-ok" : "bg-line",
                    )}
                    aria-hidden
                  />
                )}
              </div>

              {/* body */}
              <div className={clsx("min-w-0 flex-1", last ? "pb-0" : "pb-3.5")}>
                <div
                  className={clsx(
                    "flex flex-wrap items-baseline gap-x-2 text-[12.5px] font-bold",
                    done && "text-muted",
                    current && "text-ink",
                    !done && !current && "text-off",
                  )}
                >
                  <span>
                    {arNum(index + 1, locale)}. {stepTitle(step, t)}
                  </span>
                </div>

                {done && (
                  <p className="m-0 mt-0.5 text-[11.5px] text-muted">
                    {doneSummary(step, booking, { money, locale, t })}
                  </p>
                )}

                {/* The review link outlives its own step. Issuing it completes
                    step 7 and moves the booking to DONE, but the owner still
                    has to send it — so it stays on screen for as long as it is
                    valid rather than vanishing at the moment it is created. */}
                {done && step === "REVIEW" && reviewUrl && (
                  <ReviewLinkBox url={reviewUrl} booking={booking} />
                )}

                {current && (
                  <StepPanel
                    step={step}
                    booking={booking}
                    scope={scope}
                    pending={pending}
                    reviewInviteDays={reviewInviteDays}
                    bank={bank}
                    money={money}
                    percent={percent}
                    reviewUrl={reviewUrl}
                    onSubmit={submit}
                    onConfirmCommission={onConfirmCommission}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Undo — operators only, and never on step 1: undoing a confirmation is
          "cancel the booking", which also has to release the calendar. */}
      {!isOwner && isConfirmed && BOOKING_STAGES.indexOf(stage) > 1 && (
        <button
          type="button"
          onClick={onRevert}
          disabled={pending}
          className="mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] font-semibold text-muted transition hover:text-busy disabled:opacity-50"
        >
          <Icon name="history" size={14} />
          {t.workflow.undo}
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One step's controls                                                        */
/* -------------------------------------------------------------------------- */

function StepPanel({
  step,
  booking,
  scope,
  pending,
  reviewInviteDays,
  bank,
  money,
  percent,
  reviewUrl,
  onSubmit,
  onConfirmCommission,
}: {
  step: BookingStage;
  booking: WorkflowBooking;
  scope: "admin" | "owner";
  pending: boolean;
  reviewInviteDays: number;
  bank?: BankDetails | null;
  money: (n: number) => string;
  percent: (n: number) => string;
  reviewUrl: string | null;
  onSubmit: (input: StageSubmission) => void;
  onConfirmCommission: () => void;
}) {
  const { t, locale } = useLocale();

  // Amounts start at what was quoted and are editable, which is the point:
  // owner and guest settling on a different figure over WhatsApp is the normal
  // case here, and the stored "collected" columns exist to record what really
  // happened rather than what the system assumed.
  const [deposit, setDeposit] = useState(String(booking.depositDue));
  const [security, setSecurity] = useState(String(booking.securityDeposit));
  const outstanding = Math.max(0, booking.total - (booking.depositCollected ?? 0));
  const [balance, setBalance] = useState(String(outstanding));
  const [damage, setDamage] = useState("0");
  const [notes, setNotes] = useState("");
  const [reference, setReference] = useState("");

  const held = booking.securityCollected ?? booking.securityDeposit;
  const returning = Math.max(0, held - (Number(damage) || 0));
  const isOwner = scope === "owner";

  const body = (text: string) => (
    <p className="m-0 mt-1 text-[11.5px] leading-relaxed text-muted">{text}</p>
  );

  if (step === "DEPOSIT") {
    return (
      <div className="mt-1.5">
        {body(t.workflow.depositBody)}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <AmountInput
            label={t.workflow.depositAmount}
            value={deposit}
            onChange={setDeposit}
            hint={money(booking.depositDue)}
          />
          <AmountInput
            label={t.workflow.securityAmount}
            value={security}
            onChange={setSecurity}
            hint={money(booking.securityDeposit)}
          />
        </div>
        <p className="m-0 mt-1.5 text-[11px] text-muted">{t.workflow.depositHint}</p>
        <StepButton
          pending={pending}
          onClick={() =>
            onSubmit({
              step,
              depositCollected: Number(deposit) || 0,
              securityCollected: Number(security) || 0,
            })
          }
          label={t.workflow.depositAction}
          icon="event_available"
        />
      </div>
    );
  }

  if (step === "BALANCE") {
    return (
      <div className="mt-1.5">
        {body(t.workflow.balanceBody(arDayMonth(booking.checkIn, locale)))}
        <div className="mt-2 flex items-center justify-between rounded-xl bg-surface px-3 py-2 text-[11.5px]">
          <span className="text-muted">{t.workflow.outstanding}</span>
          <span className="font-bold text-ink">{money(outstanding)}</span>
        </div>
        <div className="mt-2">
          <AmountInput
            label={t.workflow.balanceAmount}
            value={balance}
            onChange={setBalance}
            hint={money(outstanding)}
          />
        </div>
        <StepButton
          pending={pending}
          onClick={() => onSubmit({ step, balanceCollected: Number(balance) || 0 })}
          label={t.workflow.balanceAction}
          icon="payments"
        />
      </div>
    );
  }

  if (step === "CHECKOUT") {
    return (
      <div className="mt-1.5">
        {body(t.workflow.checkoutBody)}
        <StepButton
          pending={pending}
          onClick={() => onSubmit({ step })}
          label={t.workflow.checkoutAction}
          icon="logout"
        />
      </div>
    );
  }

  if (step === "INSPECTION") {
    return (
      <div className="mt-1.5">
        {body(t.workflow.inspectionBody)}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder={t.workflow.inspectionNotes}
          className="mt-2 w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-[12px] text-ink outline-none focus:border-gold-500"
        />
        <StepButton
          pending={pending}
          onClick={() => onSubmit({ step, inspectionNotes: notes })}
          label={t.workflow.inspectionAction}
          icon="shield"
        />
      </div>
    );
  }

  if (step === "SECURITY") {
    return (
      <div className="mt-1.5">
        {body(t.workflow.securityBody(money(held)))}
        <div className="mt-2">
          <AmountInput
            label={t.workflow.damageAmount}
            value={damage}
            onChange={setDamage}
            max={held}
          />
        </div>
        <div className="mt-2 flex items-center justify-between rounded-xl bg-ok-bg px-3 py-2 text-[11.5px]">
          <span className="font-semibold text-ok">{t.workflow.toReturn}</span>
          <span className="font-extrabold text-ok">{money(returning)}</span>
        </div>
        <StepButton
          pending={pending}
          onClick={() => onSubmit({ step, damageDeduction: Number(damage) || 0 })}
          label={t.workflow.securityAction}
          icon="swap_vert"
        />
      </div>
    );
  }

  if (step === "COMMISSION") {
    // Two halves: the owner says they sent it, then an operator says it landed.
    // While the first is done and the second is not, both sides see the same
    // waiting line rather than an action neither of them should press.
    const sent = Boolean(booking.commissionSentAt);

    return (
      <div className="mt-1.5">
        {body(
          t.workflow.commissionBody(
            percent(booking.commissionPercent),
            money(booking.commissionDue),
          ),
        )}
        <div className="mt-2 flex items-center justify-between rounded-xl bg-gold-100 px-3 py-2.5">
          <span className="text-[11.5px] font-semibold text-bronze">
            {t.admin.commissionCol}
          </span>
          <span className="font-display text-[15px] font-extrabold text-bronze">
            {money(booking.commissionDue)}
          </span>
        </div>

        {sent ? (
          <>
            <p className="m-0 mt-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-bronze">
              <Icon name="schedule" size={14} />
              {t.workflow.commissionAwaitingAdmin}
            </p>
            {booking.commissionSentAt && (
              <p className="m-0 mt-0.5 text-[11px] text-muted">
                {t.workflow.commissionSentOn(formatInstant(booking.commissionSentAt, locale))}
                {booking.commissionReference && (
                  <>
                    {" · "}
                    <span dir="ltr">{booking.commissionReference}</span>
                  </>
                )}
              </p>
            )}
            {!isOwner && (
              <StepButton
                pending={pending}
                onClick={onConfirmCommission}
                label={t.workflow.commissionConfirmAction}
                icon="verified"
              />
            )}
          </>
        ) : (
          <>
            {/* Where the money goes. Rendered only on the half of this step
                that asks for a transfer — once it has been sent, the account
                details are noise, and the panel is replaced by the "waiting on
                the operator" line above.

                An owner with no account details on screen is told so plainly
                rather than left to guess: the alternative is a transfer to a
                number remembered from somewhere else. */}
            {hasBankDetails(bank) ? (
              <BankDetailsPanel bank={bank!} />
            ) : (
              <p className="m-0 mt-2 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-busy">
                <Icon name="error" size={14} className="mt-0.5 shrink-0" />
                {t.workflow.bankDetailsMissing}
              </p>
            )}

            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              dir="ltr"
              placeholder={t.workflow.commissionRef}
              className="mt-2 w-full rounded-xl border border-line bg-surface px-3 py-2 text-[12px] text-ink outline-none focus:border-gold-500"
            />
            <StepButton
              pending={pending}
              onClick={() => onSubmit({ step, commissionReference: reference })}
              label={t.workflow.commissionAction}
              icon="send"
            />
          </>
        )}
      </div>
    );
  }

  // step === "REVIEW"
  return (
    <div className="mt-1.5">
      {body(t.workflow.reviewBody(arNum(reviewInviteDays, locale)))}
      {reviewUrl ? (
        <ReviewLinkBox url={reviewUrl} booking={booking} />
      ) : (
        <StepButton
          pending={pending}
          onClick={() => onSubmit({ step })}
          label={t.workflow.reviewAction}
          icon="link"
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ReviewLinkBox({ url, booking }: { url: string; booking: WorkflowBooking }) {
  const { t, locale } = useLocale();
  const { toast } = useToast();

  const message = `${t.review.subtitle(booking.listingName)}\n${url}`;

  return (
    <div className="mt-2 min-w-0 rounded-xl border border-gold-500 bg-gold-100 p-2.5">
      <p className="m-0 mb-1.5 text-[11.5px] font-bold text-bronze">
        {t.workflow.reviewLinkReady}
      </p>
      {/* ─── `break-all`, and why `truncate` was not enough ───────────────────
          This line used to be `truncate`, and it still broke the page on a
          phone: the whole admin layout was pushed wider than the screen and the
          browser zoomed out to fit.

          `truncate` is `overflow:hidden` + `text-overflow:ellipsis` +
          **`white-space:nowrap`**, and that last part is the problem. Clipping
          happens at paint time, but `nowrap` means the element's *min-content*
          width is the entire unbroken string — measured here at 472px for a
          93-character review URL. Min-content is what a grid track with
          `min-width:auto` sizes itself to, so the card, its track and the page
          were all forced to 472px+ no matter how the text was later clipped. An
          element cannot ellipsis its way out of the width it demands.

          Allowing a break anywhere drops min-content from 472px to 23px — it
          becomes one character, so this line can never size anything again.
          `line-clamp-2` keeps it to two lines, which is enough to recognise the
          link; the copy button below is how anyone actually takes it, and the
          full value is in the `title` for a hover. */}
      <p
        dir="ltr"
        title={url}
        className="m-0 mb-2 line-clamp-2 rounded-lg bg-surface px-2 py-1.5 text-[10.5px] break-all text-muted"
      >
        {url}
      </p>
      {/* Wraps rather than squashing: at a phone width these two Arabic labels
          do not fit side by side, and a button whose text is clipped mid-word
          is worse than one on its own line. */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            // `navigator.clipboard` is unavailable over plain HTTP and in some
            // in-app browsers. The link is on screen and selectable either way,
            // so a failure says so rather than silently doing nothing.
            navigator.clipboard
              ?.writeText(url)
              .then(() => toast(t.workflow.linkCopied, "ok"))
              .catch(() => toast(t.workflow.copyLink, "error"));
          }}
          className="flex min-w-28 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-2 text-[11.5px] font-bold text-ink"
        >
          <Icon name="content_copy" size={14} />
          {t.workflow.copyLink}
        </button>
        <a
          href={whatsappLink(booking.customerPhone, message)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-28 flex-1 items-center justify-center gap-1.5 rounded-lg bg-wa px-2 py-2 text-[11.5px] font-bold text-wa-ink no-underline hover:no-underline"
        >
          <Icon name="chat" size={14} />
          {t.workflow.sendOnWhatsapp}
        </a>
      </div>
      {booking.reviewInviteExpiresAt && (
        <p className="m-0 mt-1.5 text-[10.5px] text-bronze">
          {t.workflow.inviteExpires(formatInstant(booking.reviewInviteExpiresAt, locale))}
        </p>
      )}
    </div>
  );
}

function AmountInput({
  label,
  value,
  onChange,
  hint,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  max?: number;
}) {
  const { t } = useLocale();
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] font-semibold text-muted">{label}</span>
      <span className="flex items-center gap-1 rounded-xl border border-line bg-surface px-2.5 py-1.5">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-w-0 border-0 bg-transparent text-[13px] font-bold text-ink outline-none"
        />
        <span className="shrink-0 text-[10.5px] text-muted">{t.common.aed}</span>
      </span>
      {hint && <span className="text-[10px] text-off">{hint}</span>}
    </label>
  );
}

function StepButton({
  pending,
  onClick,
  label,
  icon,
}: {
  pending: boolean;
  onClick: () => void;
  label: string;
  icon: IconName;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl bg-ok p-2.5 text-[12.5px] font-bold text-white transition hover:brightness-110 disabled:opacity-60"
    >
      <Icon name={icon} size={16} />
      {label}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                       */
/* -------------------------------------------------------------------------- */

type T = ReturnType<typeof useLocale>["t"];

function stepTitle(step: BookingStage, t: T): string {
  const titles: Record<string, string> = {
    DEPOSIT: t.workflow.depositTitle,
    BALANCE: t.workflow.balanceTitle,
    CHECKOUT: t.workflow.checkoutTitle,
    INSPECTION: t.workflow.inspectionTitle,
    SECURITY: t.workflow.securityTitle,
    COMMISSION: t.workflow.commissionTitle,
    REVIEW: t.workflow.reviewTitle,
  };
  return titles[step] ?? step;
}

/**
 * What a completed step collapses to.
 *
 * States the figure that was recorded, not just that it happened: "received
 * 1,500" is the line an owner reconciling their own books needs, and it is the
 * only place the difference between what was quoted and what was taken is
 * visible after the fact.
 */
function doneSummary(
  step: BookingStage,
  b: WorkflowBooking,
  ctx: { money: (n: number) => string; locale: "ar" | "en"; t: T },
): string {
  const { money, locale, t } = ctx;

  switch (step) {
    case "DEPOSIT": {
      const parts = [`${t.workflow.received} ${money(b.depositCollected ?? 0)}`];
      if ((b.securityCollected ?? 0) > 0) {
        parts.push(`${t.listing.securityDepositLabel} ${money(b.securityCollected ?? 0)}`);
      }
      return parts.join(" · ");
    }
    case "BALANCE":
      return `${t.workflow.received} ${money(b.balanceCollected ?? 0)}`;
    case "CHECKOUT":
      return formatInstant(b.checkedOutAt, locale);
    case "INSPECTION":
      return b.inspectionNotes || formatInstant(b.inspectedAt, locale);
    case "SECURITY": {
      const returned = `${t.workflow.toReturn} ${money(b.securityReturned ?? 0)}`;
      return (b.damageDeduction ?? 0) > 0
        ? `${returned} · ${t.workflow.damageAmount} ${money(b.damageDeduction ?? 0)}`
        : returned;
    }
    case "COMMISSION":
      return `${money(b.commissionDue)} · ${formatInstant(b.commissionConfirmedAt, locale)}`;
    case "REVIEW":
      return b.reviewStatus === "APPROVED"
        ? t.workflow.reviewPublished
        : b.reviewStatus === "PENDING"
          ? t.workflow.reviewPending
          : b.reviewStatus === "REJECTED"
            ? t.workflow.reviewRefused
            : t.workflow.reviewNotSubmitted;
    default:
      return "";
  }
}
