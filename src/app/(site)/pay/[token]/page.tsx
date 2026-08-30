import type { Metadata } from "next";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import { CheckoutChoice } from "@/components/booking/checkout-choice";
import { availableProviders, resolvePaymentLink } from "@/lib/payments";
import { getSettings } from "@/lib/settings";
import { arDayMonth } from "@/lib/dates";
import { arNum, formatReference } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

/**
 * The payment link page — `/pay/<token>`.
 *
 * The far end of the "semi-self" flow: the owner confirmed the booking, Rihla
 * issued a link, and the guest opens it on their phone from a WhatsApp message.
 *
 * ─── Never indexed ──────────────────────────────────────────────────────────
 * The URL contains a bearer credential for a payment, so `noindex, nofollow` —
 * the same reasoning as the review page, with more at stake. A crawler
 * *visiting* the link is harmless: opening it spends nothing, and the token is
 * only consumed when a checkout is actually started.
 *
 * ─── What this page reads, and what it does not ─────────────────────────────
 * Everything shown — the amount, the reference, the rest house — comes from
 * `resolvePaymentLink`, which loads the `PaymentLink` row. Nothing is read from
 * the query string, because there is nothing in the query string: the URL is a
 * token and no more. That is what makes the amount untamperable without a
 * signature to verify.
 *
 * Each of the failure states gets its own message rather than a generic 404.
 * The person holding an expired link is a real guest who was asked to pay and
 * came back a week later; "this link expired, ask the owner for a new one" is
 * actionable, and an attacker learns nothing from it either — a wrong token and
 * an expired one are already indistinguishable in `resolvePaymentLink`, which
 * returns LINK_INVALID for anything it cannot find.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PaymentLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { t, locale } = await getI18n();

  const lookup = await resolvePaymentLink(token);

  if (!lookup.ok) {
    const failures: Record<string, { title: string; icon: IconName }> = {
      LINK_INVALID: { title: t.payments.errorLinkInvalid, icon: "error" },
      LINK_EXPIRED: { title: t.payments.errorLinkExpired, icon: "schedule" },
      LINK_USED: { title: t.payments.errorLinkUsed, icon: "check_circle" },
      ALREADY_PAID: { title: t.payments.errorAlreadyPaid, icon: "check_circle" },
      BOOKING_NOT_PAYABLE: { title: t.payments.errorNotPayable, icon: "error" },
    };
    const copy = failures[lookup.reason] ?? {
      title: t.payments.errorLinkInvalid,
      icon: "error" as IconName,
    };

    return (
      <main className="mx-auto w-full max-w-[560px] px-4 py-14">
        <div className="rounded-[24px] border border-line bg-surface p-8 text-center shadow-e1">
          <Icon name={copy.icon} size={44} className="mx-auto text-sand-400" />
          <h1 className="mt-3.5 mb-2 font-display text-[20px] font-extrabold text-ink">
            {copy.title}
          </h1>
          <Link
            href="/"
            className="mt-5 inline-block rounded-2xl bg-night-900 px-5 py-3 text-[13.5px] font-bold text-sand-50 no-underline hover:no-underline"
          >
            {t.review.backHome}
          </Link>
        </div>
      </main>
    );
  }

  const { link } = lookup;
  const settings = await getSettings();

  // Which gateways are actually usable right now — re-read here rather than
  // trusted from when the link was issued, because an operator may have
  // switched one off in between. An empty list renders the "not available"
  // state rather than a button that cannot work.
  const providers = availableProviders(settings);

  return (
    <main className="mx-auto w-full max-w-[560px] px-4 py-10">
      <h1 className="m-0 mb-1 font-display text-[24px] font-extrabold text-ink">
        {t.payments.payTitle}
      </h1>
      <p className="m-0 mb-5 text-[14px] text-muted">{t.payments.paySubtitle}</p>

      <div className="mb-5 rounded-[24px] border border-line bg-surface p-5 shadow-e1">
        <Row label={t.admin.listings} value={link.booking.listingName} />
        <Row
          label={t.payments.payBooking}
          value={formatReference(link.booking.reference, locale)}
          ltr
        />
        <Row label={t.booking.fullName} value={link.booking.customerName} />
        <Row
          label={t.payments.payAmount}
          value={`${arNum(link.amount, locale)} ${t.common.aed}`}
          emphasis
          last
        />
      </div>

      <p className="m-0 mb-4 text-center text-[12px] text-muted">
        {t.payments.payLinkExpiresOn(arDayMonth(link.expiresAt.toISOString().slice(0, 10), locale))}
      </p>

      {providers.length === 0 ? (
        <div className="rounded-[20px] border border-line bg-sand-100 p-5 text-center text-[13px] text-muted">
          {t.payments.errorDisabled}
        </div>
      ) : (
        <CheckoutChoice token={token} providers={providers} />
      )}

      <p className="m-0 mt-5 flex items-start gap-2 text-[11.5px] leading-relaxed text-muted">
        <Icon name="verified_user" size={15} className="mt-0.5 shrink-0 text-gold-600" />
        {t.payments.paySecureNote}
      </p>
    </main>
  );
}

function Row({
  label,
  value,
  emphasis,
  last,
  ltr,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  last?: boolean;
  ltr?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-3 py-2.5 text-[13.5px] text-muted ${
        last ? "" : "border-b border-dashed border-line"
      }`}
    >
      <span>{label}</span>
      <span
        dir={ltr ? "ltr" : undefined}
        className={
          emphasis ? "font-display text-[18px] font-extrabold text-ink" : "font-bold text-ink"
        }
      >
        {value}
      </span>
    </div>
  );
}
