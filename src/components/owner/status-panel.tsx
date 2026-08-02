"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/provider";
import { arFullDate } from "@/lib/dates";
import type { OwnerAccessState } from "@/lib/constants";

/**
 * What an owner sees instead of the dashboard while their account is pending,
 * rejected, suspended or out of membership.
 *
 * Each state gets its own title, explanation and colour, because "you can't get
 * in" is not useful on its own — an owner needs to know whether to wait, to fix
 * something, to renew, or to contact support. A rejection additionally shows the
 * admin's reason when one was given.
 */

const TONE: Record<
  OwnerAccessState,
  { icon: IconName; ring: string; text: string; bg: string }
> = {
  PENDING: {
    icon: "schedule",
    ring: "border-gold-500/40",
    text: "text-bronze",
    bg: "bg-gold-100",
  },
  APPROVED: {
    icon: "check_circle",
    ring: "border-ok/40",
    text: "text-ok",
    bg: "bg-surface",
  },
  REJECTED: {
    icon: "error",
    ring: "border-busy/40",
    text: "text-busy",
    bg: "bg-busy-bg",
  },
  SUSPENDED: {
    icon: "lock",
    ring: "border-busy/40",
    text: "text-busy",
    bg: "bg-busy-bg",
  },
  EXPIRED: {
    icon: "event_busy",
    ring: "border-gold-500/40",
    text: "text-bronze",
    bg: "bg-gold-100",
  },
};

export function OwnerStatusPanel({
  state,
  rejectionReason,
  membershipExpiresAt,
}: {
  state: OwnerAccessState;
  rejectionReason?: string | null;
  /** ISO "YYYY-MM-DD", or null. */
  membershipExpiresAt?: string | null;
}) {
  const { t, locale } = useLocale();
  const tone = TONE[state];

  const copy: Record<OwnerAccessState, { title: string; body: string }> = {
    PENDING: { title: t.owner.statusPendingTitle, body: t.owner.statusPendingBody },
    APPROVED: { title: t.owner.statusApprovedTitle, body: t.owner.statusApprovedBody },
    REJECTED: { title: t.owner.statusRejectedTitle, body: t.owner.statusRejectedBody },
    SUSPENDED: { title: t.owner.statusSuspendedTitle, body: t.owner.statusSuspendedBody },
    EXPIRED: { title: t.owner.statusExpiredTitle, body: t.owner.statusExpiredBody },
  };

  return (
    <div className="animate-fade-up mx-auto max-w-[640px] py-6">
      <div className={`rounded-[28px] border ${tone.ring} ${tone.bg} p-7 text-center md:p-10`}>
        <Icon name={tone.icon} size={54} className={`mx-auto ${tone.text}`} />

        <h1 className="mt-4 mb-2 font-display text-[21px] font-extrabold text-ink">
          {copy[state].title}
        </h1>
        <p className="mx-auto m-0 max-w-[48ch] text-[14.5px] leading-[1.9] text-muted">
          {copy[state].body}
        </p>

        {state === "REJECTED" && rejectionReason && (
          <div className="mt-5 rounded-2xl border border-line bg-surface p-4 text-start">
            <div className="mb-1.5 text-[12px] font-bold text-bronze">
              {t.owner.rejectionReason}
            </div>
            <p className="m-0 text-[14px] leading-[1.85] text-ink">{rejectionReason}</p>
          </div>
        )}

        {state === "EXPIRED" && membershipExpiresAt && (
          <div className="mt-5 rounded-2xl border border-line bg-surface p-4">
            <div className="mb-1.5 text-[12px] font-bold text-bronze">
              {t.owner.membershipExpiry}
            </div>
            <p className="m-0 text-[14px] font-bold text-ink">
              {t.owner.membershipExpired(arFullDate(membershipExpiresAt, locale))}
            </p>
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <Link
            href="/"
            className="rounded-full border border-line bg-surface px-5 py-2.5 text-[13.5px] font-bold text-ink no-underline hover:border-gold-500 hover:no-underline"
          >
            {t.notFound.home}
          </Link>
          <Link
            href="/listings"
            className="rounded-full bg-night-900 px-5 py-2.5 text-[13.5px] font-bold text-sand-100 no-underline hover:bg-night-700 hover:no-underline"
          >
            {t.common.browse}
          </Link>
        </div>
      </div>
    </div>
  );
}
