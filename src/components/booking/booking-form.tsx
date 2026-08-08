"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { PhoneInput } from "@/components/ui/phone-input";
import { HumanCheck } from "@/components/security/human-check";
import { createBookingRequest } from "@/app/actions/booking";
import { arDayMonth } from "@/lib/dates";
import { arNum } from "@/lib/format";
import { useLocale } from "@/lib/i18n/provider";
import type { ResolvedCancelPolicy } from "@/lib/policies";

/**
 * Booking request form.
 *
 * The dates come in through the URL (set on the detail page) and are shown
 * read-only here with a link back to the calendar — the design's flow, and it
 * keeps date-picking in the one place that knows what's blocked.
 *
 * On success we redirect to /booking/<reference>, which shows the confirmation
 * screen and the WhatsApp button. Opening WhatsApp from here instead would be
 * blocked by popup blockers: `window.open` only survives if it happens in the
 * same tick as the click, and we have to await the server round-trip first.
 */
export function BookingForm({
  listingId,
  listingSlug,
  checkIn,
  checkOut,
  dayUse,
  dayUseCheckOutTime,
  guests: initialGuests,
  capacity,
  cancel,
  depositPercent,
}: {
  listingId: string;
  listingSlug: string;
  checkIn: string;
  checkOut: string;
  /** A day booking (حجز بدون مبيت): one day, `checkOut === checkIn`. */
  dayUse: boolean;
  /** The hour a day guest must leave by. "" when the owner set none. */
  dayUseCheckOutTime: string;
  guests: number;
  capacity: number;
  cancel: ResolvedCancelPolicy;
  depositPercent: number;
}) {
  const router = useRouter();
  const { t, locale } = useLocale();
  const [pending, startTransition] = useTransition();

  const [guests, setGuests] = useState(initialGuests);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // The human check reports when it has a verified, submittable challenge; the
  // send button waits for it. In practice it settles long before anyone has
  // finished typing their phone number — see the widget for why.
  const [humanReady, setHumanReady] = useState(false);
  const [checkKey, setCheckKey] = useState(0);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await createBookingRequest(formData);
      if (result.ok) {
        router.push(`/booking/${result.reference}`);
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});

        // A failure with no field attached can be a spent or expired challenge —
        // a double-submit, or a tab left open. Mint a fresh one so the next press
        // of the button works instead of failing the same way again. Field
        // errors keep the current challenge: the guest is fixing a typo, not
        // starting over.
        if (!result.fieldErrors) setCheckKey((n) => n + 1);

        // Bring the message into view — the button is at the bottom of a long form.
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  const stepHeading = (n: string, label: string) => (
    <div className="mb-3.5 flex items-center gap-2 font-display text-[15.5px] font-extrabold text-ink">
      <span className="grid size-6 place-items-center rounded-lg bg-gold-100 text-[12px] font-extrabold text-bronze">
        {n}
      </span>
      {label}
    </div>
  );

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-5 rounded-[28px] border border-line bg-surface p-5 shadow-e1 md:p-7"
    >
      {/* values the server needs but the guest can't edit here */}
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="checkIn" value={checkIn} />
      <input type="hidden" name="checkOut" value={checkOut} />
      {/* Sent only when it is true, which is what a checkbox would do, and what
          the action reads. Like every other hidden field here it is a *claim*:
          `createBookingRequest` re-checks that this listing offers day use and
          prices it from the database regardless. */}
      {dayUse && <input type="hidden" name="dayUse" value="on" />}

      {error && (
        <p
          role="alert"
          className="m-0 flex items-center gap-2 rounded-xl bg-busy-bg px-3.5 py-3 text-[13px] font-semibold text-busy"
        >
          <Icon name="error" size={18} />
          {error}
        </p>
      )}

      {/* ---- step 1: stay ---- */}
      <div>
        {stepHeading(locale === "ar" ? "١" : "1", t.booking.stayDetails)}
        <div className="grid gap-3 sm:grid-cols-3">
          {/* A day booking has one date, not two. Showing the same day twice
              under "check-in" and "check-out" is technically what is stored,
              and reads as a mistake to the guest about to confirm it. */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-bronze">
              {dayUse ? t.booking.dayUseDate : t.booking.checkInDate}
            </span>
            <span className="flex items-center gap-2 rounded-[13px] border border-line bg-sand-50 px-3.5 py-3 text-[14.5px] font-semibold text-ink">
              <Icon name="calendar_today" size={19} className="text-gold-600" />
              {arDayMonth(checkIn, locale)}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-bronze">
              {dayUse ? t.booking.dayUseLeaveLabel : t.booking.checkOutDate}
            </span>
            <span className="flex items-center gap-2 rounded-[13px] border border-line bg-sand-50 px-3.5 py-3 text-[14.5px] font-semibold text-ink">
              <Icon name={dayUse ? "schedule" : "event"} size={19} className="text-gold-600" />
              {dayUse
                ? dayUseCheckOutTime || t.booking.dayUseSameDay
                : arDayMonth(checkOut, locale)}
            </span>
          </div>

          <Field
            label={t.booking.guestCount}
            required
            error={fieldErrors.guests}
            hint={t.booking.maxGuests(arNum(capacity, locale))}
          >
            <TextInput
              name="guests"
              type="number"
              min={1}
              max={capacity}
              value={guests}
              onChange={(e) => setGuests(Number(e.target.value) || 1)}
              invalid={Boolean(fieldErrors.guests)}
              required
            />
          </Field>
        </div>

        <Link
          href={`/listings/${encodeURIComponent(listingSlug)}#availability`}
          className="mt-2.5 inline-block text-[12.5px] font-semibold text-bronze underline underline-offset-3"
        >
          {t.booking.changeDates}
        </Link>
      </div>

      <div className="h-px bg-line" />

      {/* ---- step 2: contact ---- */}
      <div>
        {stepHeading(locale === "ar" ? "٢" : "2", t.booking.contactDetails)}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.booking.fullName} required error={fieldErrors.customerName}>
            <TextInput
              name="customerName"
              placeholder={t.booking.fullNamePlaceholder}
              autoComplete="name"
              required
              invalid={Boolean(fieldErrors.customerName)}
            />
          </Field>

          <Field label={t.booking.phone} required error={fieldErrors.customerPhone}>
            <PhoneInput
              name="customerPhone"
              autoComplete="tel"
              required
              invalid={Boolean(fieldErrors.customerPhone)}
              className="text-end"
            />
          </Field>
        </div>

        <Field
          label={t.booking.email}
          error={fieldErrors.customerEmail}
          className="mt-3"
        >
          <TextInput
            name="customerEmail"
            type="email"
            dir="ltr"
            placeholder="name@example.com"
            autoComplete="email"
            invalid={Boolean(fieldErrors.customerEmail)}
            className="text-end"
          />
        </Field>

        <Field label={t.booking.extraNotes} className="mt-3">
          <TextArea
            name="notes"
            rows={4}
            placeholder={t.booking.notesPlaceholder}
          />
        </Field>
      </div>

      <div className="h-px bg-line" />

      {/* ---- policy ---- */}
      <div className="flex gap-3 rounded-2xl border border-line bg-sand-50 p-3.5">
        <Icon name="policy" size={21} className="shrink-0 text-bronze" />
        <p className="m-0 text-[12.5px] leading-[1.85] text-muted">
          {t.booking.policyIntro}{" "}
          <Link href="/policies" className="text-bronze">
            {t.booking.policyLink}
          </Link>
          {/* Six sentences, not one with two numbers in it. Three cancellation
              answers times "is there a deposit", written out rather than
              assembled: a 0% deposit and a 0-hour window are both real answers
              an owner can give, and "a 0% deposit is due" or "free up to 0
              hours before" each read as a bug to a customer — the second worse
              than a bug, because it implies a window this rest house does not
              offer. "Ask the owner" needs its own pair for the same reason:
              there is no number to put in the sentence at all. */}
          {cancel.kind === "hours"
            ? depositPercent > 0
              ? t.booking.policyDetail(
                  arNum(cancel.hours, locale),
                  arNum(depositPercent, locale),
                )
              : t.booking.policyDetailNoDeposit(arNum(cancel.hours, locale))
            : cancel.kind === "ask"
              ? depositPercent > 0
                ? t.booking.policyDetailAsk(arNum(depositPercent, locale))
                : t.booking.policyDetailAskNoDeposit
              : depositPercent > 0
                ? t.booking.policyDetailNoCancel(arNum(depositPercent, locale))
                : t.booking.policyDetailNoCancelNoDeposit}
        </p>
      </div>

      <HumanCheck
        purpose="booking"
        resetKey={checkKey}
        onReadyChange={setHumanReady}
        className="relative"
      />

      <button
        type="submit"
        disabled={pending || !humanReady}
        title={humanReady ? undefined : t.security.waitForCheck}
        className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-wa p-4.5 font-display text-[16px] font-extrabold text-wa-ink shadow-[0_12px_28px_rgb(37_211_102/0.26)] transition hover:brightness-105 active:translate-y-px disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? (
          <>
            <Icon name="schedule" size={22} />
            {t.booking.submitting}
          </>
        ) : (
          <>
            <Icon name="send" size={22} />
            {t.booking.submit}
          </>
        )}
      </button>

      <p className="m-0 text-center text-[12px] text-muted">{t.booking.noPaymentOnline}</p>
    </form>
  );
}
