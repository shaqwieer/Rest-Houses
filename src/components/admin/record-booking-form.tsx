"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/lib/i18n/provider";
import { recordBooking } from "@/app/actions/manual-booking";
import { CALENDAR_PLATFORM_NAMES, RECORDABLE_SOURCES } from "@/lib/constants";
import { localized } from "@/lib/i18n/config";

/**
 * The form behind "record an outside booking".
 *
 * One component for both dashboards — the operator's copy and the owner's are
 * the same form on two routes, differing only in which rest houses the server
 * put in `listings`. The scoping is done there and re-checked in the action, so
 * this component never decides who may write what.
 *
 * ─── Why the check-out field disappears for a day booking ───────────────────
 * A day-use stay arrives and leaves on one day, and the row stores
 * `checkOut === checkIn` because that is the truth (see the note on
 * `BookingRequest.dayUse` in prisma/schema.prisma). Leaving a check-out box on
 * screen for it invites a date that would then be ignored, so the field is
 * removed and the check-in label changes to "the day" — the form asks for
 * exactly what it will store.
 *
 * ─── The two notices are permanent, not conditional ─────────────────────────
 * No commission is charged on a recorded booking, and a wholly-past one leaves
 * the calendar alone. Both are consequences the person filling this in has to
 * know BEFORE they submit, not facts to be discovered afterwards in their
 * revenue figures — `commissionPercent` is a snapshot column, so 0 is a
 * permanent statement about the booking.
 */
export function RecordBookingForm({
  listings,
  backHref,
}: {
  listings: { id: string; name: string; nameEn: string | null }[];
  backHref: string;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dayUse, setDayUse] = useState(false);

  if (listings.length === 0) {
    return (
      <p className="m-0 rounded-[20px] border border-dashed border-sand-300 bg-surface p-5 text-center text-[13.5px] text-muted">
        {t.recordBooking.noListings}
      </p>
    );
  }

  const sourceLabel = (source: (typeof RECORDABLE_SOURCES)[number]) => {
    if (source === "DIRECT") return t.recordBooking.sourceDirect;
    // Airbnb and Booking.com are proper nouns and identical in both languages —
    // see the note on CALENDAR_PLATFORM_NAMES. Only "OTHER" needs translating.
    return CALENDAR_PLATFORM_NAMES[source] || t.calendar.platformOther;
  };

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await recordBooking(formData);
      if (result.ok) {
        toast(result.message ?? t.validation.bookingRecorded);
        router.push(backHref);
        // The list this returns to is a server component reading the row that
        // was just written; without this it renders from the cached payload and
        // the booking appears to have vanished.
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <div className="rounded-[20px] border border-line bg-surface p-4.5 shadow-e1">
        <p className="m-0 mb-4 text-[13px] leading-[1.85] text-muted">
          {t.recordBooking.intro}
        </p>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label={t.recordBooking.listing} required className="sm:col-span-2">
            <Select name="listingId" required defaultValue={listings[0]?.id}>
              {listings.map((listing) => (
                <option key={listing.id} value={listing.id}>
                  {localized(listing.name, listing.nameEn, locale)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t.recordBooking.source} required>
            <Select name="source" required defaultValue="DIRECT">
              {RECORDABLE_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {sourceLabel(source)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t.recordBooking.guests} required>
            <TextInput
              name="guests"
              type="number"
              inputMode="numeric"
              min={1}
              defaultValue={2}
              required
            />
          </Field>

          <Field label={t.recordBooking.guestName} required>
            <TextInput name="customerName" required maxLength={120} autoComplete="off" />
          </Field>

          <Field label={t.recordBooking.guestPhone} required>
            {/* Latin digits deliberately, like every other number input on the
                site: keyboards, validation and parsing all behave normally, and
                the action normalises whatever arrives. */}
            <TextInput
              name="customerPhone"
              type="tel"
              dir="ltr"
              required
              maxLength={20}
              placeholder="+9715…"
              autoComplete="off"
            />
          </Field>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-[13px] border border-line bg-sand-50 px-3.5 py-3 text-[13.5px] font-semibold text-ink sm:col-span-2">
            <input
              type="checkbox"
              name="dayUse"
              checked={dayUse}
              onChange={(e) => setDayUse(e.target.checked)}
              className="size-4 accent-[var(--gold-600)]"
            />
            {t.recordBooking.dayUse}
          </label>

          <Field
            label={dayUse ? t.recordBooking.theDay : t.recordBooking.checkIn}
            required
            className={dayUse ? "sm:col-span-2" : undefined}
          >
            <TextInput name="checkIn" type="date" required />
          </Field>

          {!dayUse && (
            <Field label={t.recordBooking.checkOut} required>
              <TextInput name="checkOut" type="date" required />
            </Field>
          )}

          <Field
            label={t.recordBooking.amount}
            hint={t.recordBooking.amountHint}
            required
            className="sm:col-span-2"
          >
            <TextInput
              name="amount"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              defaultValue={0}
              required
            />
          </Field>

          <Field label={t.recordBooking.notes} className="sm:col-span-2">
            <TextArea
              name="notes"
              rows={3}
              maxLength={2000}
              placeholder={t.recordBooking.notesPlaceholder}
            />
          </Field>
        </div>
      </div>

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        <Notice icon="receipt_long" text={t.recordBooking.commissionNote} />
        <Notice icon="calendar_month" text={t.recordBooking.pastNote} />
      </ul>

      {error && (
        <p className="m-0 flex items-center gap-2 rounded-xl bg-busy-bg px-3.5 py-3 text-[13px] font-semibold text-busy">
          <Icon name="error" size={17} />
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2.5">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? t.recordBooking.submitting : t.recordBooking.submit}
        </Button>
      </div>
    </form>
  );
}

function Notice({ icon, text }: { icon: "receipt_long" | "calendar_month"; text: string }) {
  return (
    <li className="flex items-start gap-2.5 rounded-2xl border border-gold-300 bg-gold-100/60 px-3.5 py-3 text-[12.5px] leading-[1.8] text-ink">
      <Icon name={icon} size={17} className="mt-0.5 shrink-0 text-bronze" />
      <span>{text}</span>
    </li>
  );
}
