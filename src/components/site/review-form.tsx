"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { submitGuestReview } from "@/app/actions/reviews";
import { REVIEW_RATING_MAX } from "@/lib/constants";
import { useLocale } from "@/lib/i18n/provider";
import { arNum } from "@/lib/format";

/**
 * The form a guest fills in from their review link.
 *
 * Rendered for somebody with no account and no session — the token in the URL
 * is the whole of their authorisation, and it is re-checked by the action on
 * submit rather than trusted from the page that drew this. See
 * src/lib/reviews.ts.
 *
 * The success state replaces the form rather than sitting above it. The invite
 * is single-use, so leaving a filled-in form on screen after it was spent would
 * invite a second submission that can only ever fail.
 */
export function ReviewForm({
  token,
  listingName,
}: {
  token: string;
  listingName: string;
}) {
  const { t, locale } = useLocale();
  const [pending, startTransition] = useTransition();
  const [rating, setRating] = useState(5);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="rounded-[24px] border border-ok bg-ok-bg p-7 text-center">
        <Icon name="check_circle" size={44} className="mx-auto text-ok" />
        <h2 className="mt-3 mb-1.5 font-display text-[19px] font-extrabold text-ink">
          {t.review.thanksTitle}
        </h2>
        <p className="m-0 text-[13.5px] leading-relaxed text-muted">{t.review.thanksBody}</p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-2xl bg-night-900 px-5 py-3 text-[13.5px] font-bold text-sand-50 no-underline hover:no-underline"
        >
          {t.review.backHome}
        </Link>
      </div>
    );
  }

  function onSubmit(formData: FormData) {
    formData.set("rating", String(rating));

    startTransition(async () => {
      const result = await submitGuestReview(token, formData);
      if (result.ok) {
        setSent(true);
        return;
      }
      setFormError(result.error);
      setErrors(result.fieldErrors ?? {});
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <Field label={t.review.ratingLabel} required>
        {/* Radio inputs behind the stars, not buttons: this is a single choice
            from five, it has to be reachable by keyboard, and it must submit
            even if the page's JavaScript never runs. */}
        <fieldset className="m-0 flex flex-row-reverse justify-end gap-1.5 border-0 p-0">
          <legend className="sr-only">{t.review.ratingLabel}</legend>
          {Array.from({ length: REVIEW_RATING_MAX }, (_, i) => REVIEW_RATING_MAX - i).map(
            (value) => (
              <label
                key={value}
                className="cursor-pointer"
                title={`${arNum(value, locale)}/${arNum(REVIEW_RATING_MAX, locale)}`}
              >
                <input
                  type="radio"
                  name="ratingChoice"
                  value={value}
                  checked={rating === value}
                  onChange={() => setRating(value)}
                  className="peer sr-only"
                />
                <Icon
                  name="star"
                  size={30}
                  className={clsx(
                    "transition peer-focus-visible:opacity-100",
                    value <= rating ? "text-gold-500" : "text-sand-300",
                  )}
                  label={`${value}`}
                />
              </label>
            ),
          )}
        </fieldset>
      </Field>

      <Field label={t.review.nameLabel} error={errors.authorName} required>
        <TextInput name="authorName" required maxLength={80} />
      </Field>

      <Field label={t.review.bodyLabel} error={errors.body} required>
        <TextArea name="body" rows={5} required maxLength={2000} placeholder={t.review.bodyPlaceholder} />
      </Field>

      {formError && (
        <p className="m-0 flex items-center gap-2 rounded-xl bg-busy-bg px-3.5 py-3 text-[13px] font-semibold text-busy">
          <Icon name="error" size={17} />
          {formError}
        </p>
      )}

      <p className="m-0 flex items-start gap-2 text-[12px] leading-relaxed text-muted">
        <Icon name="info" size={15} className="mt-0.5 shrink-0 text-bronze" />
        {t.review.moderationNote}
      </p>

      <button
        type="submit"
        disabled={pending}
        className="rounded-2xl bg-night-900 p-3.5 text-[14.5px] font-bold text-sand-50 transition hover:brightness-125 disabled:opacity-60"
      >
        {pending ? t.common.saving : t.review.submit}
      </button>

      <span className="sr-only">{listingName}</span>
    </form>
  );
}
