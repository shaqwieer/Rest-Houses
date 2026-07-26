"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { createBookingRequest } from "@/app/actions/booking";
import { arDayMonth } from "@/lib/dates";
import { arNum } from "@/lib/format";

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
  guests: initialGuests,
  capacity,
  freeCancelHours,
  depositPercent,
}: {
  listingId: string;
  listingSlug: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  capacity: number;
  freeCancelHours: number;
  depositPercent: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [guests, setGuests] = useState(initialGuests);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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
        {stepHeading("١", "تفاصيل الإقامة")}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-bronze">تاريخ الوصول</span>
            <span className="flex items-center gap-2 rounded-[13px] border border-line bg-sand-50 px-3.5 py-3 text-[14.5px] font-semibold text-ink">
              <Icon name="calendar_today" size={19} className="text-gold-600" />
              {arDayMonth(checkIn)}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-bronze">تاريخ المغادرة</span>
            <span className="flex items-center gap-2 rounded-[13px] border border-line bg-sand-50 px-3.5 py-3 text-[14.5px] font-semibold text-ink">
              <Icon name="event" size={19} className="text-gold-600" />
              {arDayMonth(checkOut)}
            </span>
          </div>

          <Field label="عدد الضيوف" required error={fieldErrors.guests} hint={`الحد الأقصى ${arNum(capacity)}`}>
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
          تغيير التواريخ من التقويم
        </Link>
      </div>

      <div className="h-px bg-line" />

      {/* ---- step 2: contact ---- */}
      <div>
        {stepHeading("٢", "بيانات التواصل")}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="الاسم الكامل" required error={fieldErrors.customerName}>
            <TextInput
              name="customerName"
              placeholder="مثال: خالد المنصوري"
              autoComplete="name"
              required
              invalid={Boolean(fieldErrors.customerName)}
            />
          </Field>

          <Field label="رقم الجوال (واتساب)" required error={fieldErrors.customerPhone}>
            <TextInput
              name="customerPhone"
              type="tel"
              // Latin digits and LTR here on purpose: this is a phone number, and
              // `inputMode="tel"` gives the right keypad on a phone.
              dir="ltr"
              inputMode="tel"
              placeholder="+971 5X XXX XXXX"
              autoComplete="tel"
              required
              invalid={Boolean(fieldErrors.customerPhone)}
              className="text-end"
            />
          </Field>
        </div>

        <Field
          label="البريد الإلكتروني (اختياري)"
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

        <Field label="ملاحظات إضافية" className="mt-3">
          <TextArea
            name="notes"
            rows={4}
            placeholder="مثال: نحتاج تجهيز المجلس قبل المغرب، ووجود ألعاب أطفال."
          />
        </Field>
      </div>

      <div className="h-px bg-line" />

      {/* ---- policy ---- */}
      <div className="flex gap-3 rounded-2xl border border-line bg-sand-50 p-3.5">
        <Icon name="policy" size={21} className="shrink-0 text-bronze" />
        <p className="m-0 text-[12.5px] leading-[1.85] text-muted">
          بإرسال الطلب فإنك توافق على{" "}
          <Link href="/policies" className="text-bronze">
            سياسة الحجز والإلغاء
          </Link>
          . الإلغاء مجاني حتى {arNum(freeCancelHours)} ساعة قبل موعد الوصول، ويُستحق عربون{" "}
          {arNum(depositPercent)}٪ عند تأكيد المالك.
        </p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-wa p-4.5 font-display text-[16px] font-extrabold text-wa-ink shadow-[0_12px_28px_rgb(37_211_102/0.26)] transition hover:brightness-105 active:translate-y-px disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? (
          <>
            <Icon name="schedule" size={22} />
            جارٍ إرسال الطلب…
          </>
        ) : (
          <>
            <Icon name="send" size={22} />
            إرسال الطلب عبر الواتساب
          </>
        )}
      </button>

      <p className="m-0 text-center text-[12px] text-muted">
        لا يُطلب أي دفع عبر الموقع — يتواصل معك المالك للتأكيد.
      </p>
    </form>
  );
}
