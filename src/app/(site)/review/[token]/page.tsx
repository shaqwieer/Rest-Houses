import type { Metadata } from "next";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import { ReviewForm } from "@/components/site/review-form";
import { lookupReviewInvite } from "@/lib/reviews";
import { arDayMonth } from "@/lib/dates";
import { getI18n } from "@/lib/i18n/server";

/**
 * The guest's review page — the far end of step 7 of the booking workflow.
 *
 * ─── Never indexed ──────────────────────────────────────────────────────────
 * `robots: noindex, nofollow` because the URL contains a single-use credential.
 * A crawler that indexed one would put a working review token into a search
 * result, and a crawler that *followed* it would be a visit — which is
 * harmless only because visiting does not spend the token; submitting does.
 *
 * The three failure states get their own copy rather than a generic 404. The
 * person holding an expired link is a real guest who did what they were asked,
 * a little late, and "this link expired" is a different message from "no such
 * page" — for them, not for an attacker, who learns nothing either way.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { t, locale } = await getI18n();

  const lookup = await lookupReviewInvite(token);

  if (!lookup.ok) {
    const failures: Record<
      typeof lookup.reason,
      { title: string; body: string; icon: IconName }
    > = {
      NOT_FOUND: { title: t.review.invalidTitle, body: t.review.invalidBody, icon: "error" },
      EXPIRED: { title: t.review.expiredTitle, body: t.review.expiredBody, icon: "schedule" },
      USED: { title: t.review.usedTitle, body: t.review.usedBody, icon: "check_circle" },
    };
    const copy = failures[lookup.reason];

    return (
      <main className="mx-auto w-full max-w-[560px] px-4 py-14">
        <div className="rounded-[24px] border border-line bg-surface p-8 text-center shadow-e1">
          <Icon name={copy.icon} size={44} className="mx-auto text-sand-400" />
          <h1 className="mt-3.5 mb-2 font-display text-[20px] font-extrabold text-ink">
            {copy.title}
          </h1>
          <p className="m-0 text-[13.5px] leading-relaxed text-muted">{copy.body}</p>
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

  const { invite } = lookup;

  return (
    <main className="mx-auto w-full max-w-[560px] px-4 py-10">
      <h1 className="m-0 mb-1 font-display text-[24px] font-extrabold text-ink">
        {t.review.title}
      </h1>
      <p className="m-0 mb-5 text-[14px] text-muted">
        {t.review.subtitle(invite.listingName)}
      </p>

      <div className="mb-5 flex items-center gap-2.5 rounded-[18px] border border-line bg-sand-50 px-4 py-3">
        <Icon name="calendar_month" size={18} className="text-gold-600" />
        <div className="min-w-0">
          <span className="block text-[11px] text-muted">{t.review.stayLabel}</span>
          <span className="block text-[13px] font-bold text-ink">
            {arDayMonth(invite.checkIn, locale)} – {arDayMonth(invite.checkOut, locale)}
          </span>
        </div>
      </div>

      <div className="rounded-[24px] border border-line bg-surface p-5 shadow-e1">
        <ReviewForm token={token} listingName={invite.listingName} />
      </div>
    </main>
  );
}
