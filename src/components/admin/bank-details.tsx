"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/provider";

/**
 * The platform's bank account, shown to an owner who owes commission.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 * Step 6 of the booking workflow asks the owner to transfer `commissionDue` by
 * bank and type the reference back in. It has always asked without ever saying
 * *where* to send it — the account details lived in a WhatsApp message from
 * whenever the owner joined, which is exactly the sort of thing that goes stale
 * after the platform changes bank and gets mistyped in between. Putting them on
 * the step means the number an owner pays into is the number the operator last
 * saved, every time.
 *
 * ─── Empty means absent ──────────────────────────────────────────────────────
 * Each row renders only when its value is set, and the whole panel disappears
 * when none of them are. A platform that has not filled these in sees precisely
 * the step it had before rather than a form of blank labels — and, more to the
 * point, an owner is never shown "Account number:" with nothing after it, which
 * reads as a bug at the exact moment they are about to move money.
 */

export type BankDetails = {
  bankName: string;
  bankAccountHolder: string;
  bankAccountNumber: string;
  bankIban: string;
};

/** True when there is at least one detail worth rendering. */
export function hasBankDetails(bank: BankDetails | null | undefined): boolean {
  if (!bank) return false;
  return Boolean(
    bank.bankName || bank.bankAccountHolder || bank.bankAccountNumber || bank.bankIban,
  );
}

export function BankDetailsPanel({ bank }: { bank: BankDetails }) {
  const { t } = useLocale();

  if (!hasBankDetails(bank)) return null;

  return (
    <div className="mt-2.5 rounded-xl border border-line bg-sand-50 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-extrabold text-bronze">
        <Icon name="payments" size={15} />
        {t.workflow.bankTransferTo}
      </div>

      <dl className="m-0 flex flex-col gap-1.5">
        <Row label={t.admin.fieldBankName} value={bank.bankName} />
        <Row label={t.admin.fieldAccountHolder} value={bank.bankAccountHolder} />
        <Row label={t.admin.fieldAccountNumber} value={bank.bankAccountNumber} copyable />
        <Row label={t.admin.fieldIban} value={bank.bankIban} copyable />
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  copyable,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  if (!value) return null;

  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="shrink-0 text-[11px] font-semibold text-muted">{label}</dt>
      <dd className="m-0 flex min-w-0 items-center gap-1.5">
        {/* `dir="ltr"` on the value only. An IBAN is a Latin reference code and
            mirroring it inside an RTL row prints its groups in the wrong order —
            which, for a number someone is about to copy into a banking app, is
            not a cosmetic problem.

            `break-all` rather than `truncate`, for the reason set out on the
            review link in booking-workflow.tsx: `truncate` implies
            `white-space: nowrap`, which makes this element's min-content width
            the whole 23-character IBAN and lets it push the panel — and on a
            phone, the page — wider than the screen.

            Wrapping also beats clipping *here* specifically. This is the number
            an owner is about to transfer money to; half an IBAN followed by an
            ellipsis is worse than two lines they can actually check against
            their banking app. */}
        <span dir="ltr" className="text-[12px] font-bold break-all text-ink" title={value}>
          {value}
        </span>
        {copyable && <CopyButton value={value} />}
      </dd>
    </div>
  );
}

/**
 * Copy to clipboard, because the alternative is retyping a 23-character IBAN
 * into a banking app from a phone screen. Falls back silently: `navigator
 * .clipboard` is undefined on an insecure origin, and a button that throws is
 * worse than one that does nothing while the value stays selectable above it.
 */
function CopyButton({ value }: { value: string }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // No clipboard permission or no secure context — nothing to do.
        }
      }}
      aria-label={t.common.copy}
      title={copied ? t.common.copied : t.common.copy}
      className="shrink-0 text-muted transition hover:text-bronze"
    >
      <Icon name={copied ? "check_circle" : "content_copy"} size={15} />
    </button>
  );
}
