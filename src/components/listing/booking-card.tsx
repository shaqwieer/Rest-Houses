"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { useBooking } from "./booking-context";
import { AvailabilityCalendar } from "./availability-calendar";
import { arDayMonth } from "@/lib/dates";
import { arNum } from "@/lib/format";

/** The calendar section in the main column. Reads/writes the shared selection. */
export function CalendarSection({ checkIn, checkOut }: { checkIn: string; checkOut: string }) {
  const { range, setRange, unavailableDates } = useBooking();

  return (
    <section id="availability" className="border-b border-line py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3.5">
        <div>
          <h2 className="m-0 mb-1 font-display text-[19px] font-extrabold text-ink">
            التوفّر والحجز
          </h2>
          <p className="m-0 text-[13.5px] text-muted">اختر تاريخ الوصول ثم تاريخ المغادرة</p>
        </div>
        <p className="m-0 text-[12.5px] text-muted">
          الدخول {checkIn} · الخروج {checkOut}
        </p>
      </div>

      <AvailabilityCalendar
        unavailableDates={unavailableDates}
        value={range}
        onChange={setRange}
        months={2}
      />
    </section>
  );
}

/**
 * Sticky price + request card (desktop) — the design's `bookCardStyle` aside.
 *
 * The button navigates to the booking form carrying the selection in the URL,
 * rather than posting from here. That way the form page can be deep-linked, the
 * selection survives a refresh, and the server re-validates the dates against
 * the calendar before anything is written.
 */
export function BookingCard({
  slug,
  pricePerNight,
  weekendPrice,
  capacity,
  ownerName,
  serviceFeePercent,
  depositPercent,
  freeCancelHours,
}: {
  slug: string;
  pricePerNight: number;
  weekendPrice: number;
  capacity: number;
  ownerName: string;
  serviceFeePercent: number;
  depositPercent: number;
  freeCancelHours: number;
}) {
  const { range, guests, setGuests, currentQuote, bookingQuery } = useBooking();
  const href = `/listings/${encodeURIComponent(slug)}/book${bookingQuery}`;
  const ready = Boolean(range.checkIn && range.checkOut);

  const rangeLabel = range.checkIn
    ? range.checkOut
      ? `${arDayMonth(range.checkIn)} – ${arDayMonth(range.checkOut)}`
      : "اختر تاريخ المغادرة"
    : "اختر تاريخ الوصول";

  return (
    <aside className="hidden lg:sticky lg:top-[150px] lg:block lg:rounded-[28px] lg:border lg:border-sand-300 lg:bg-surface lg:p-5.5 lg:shadow-e2">
      <div className="mb-1 flex items-end justify-between gap-2.5">
        <div>
          <span className="font-display text-[26px] font-extrabold text-ink">
            {arNum(pricePerNight)}
          </span>
          <span className="text-[13px] font-semibold text-muted"> د.إ / الليلة</span>
        </div>
        {weekendPrice > pricePerNight && (
          <span className="text-[12px] text-muted">الجمعة والسبت {arNum(weekendPrice)}</span>
        )}
      </div>

      <div className="my-4 h-px bg-line" />

      <div className="mb-2.5 grid grid-cols-2 gap-2">
        <div className="rounded-[13px] border border-line bg-sand-50 px-3 py-2.5">
          <span className="mb-0.5 block text-[11px] font-bold text-bronze">التواريخ</span>
          <span className="block text-[13.5px] font-bold text-ink">{rangeLabel}</span>
        </div>
        <label className="rounded-[13px] border border-line bg-sand-50 px-3 py-2.5">
          <span className="mb-0.5 block text-[11px] font-bold text-bronze">الضيوف</span>
          <input
            type="number"
            min={1}
            max={capacity}
            value={guests}
            onChange={(e) => setGuests(Number(e.target.value) || 1)}
            aria-label="عدد الضيوف"
            className="w-full border-0 bg-transparent p-0 text-[13.5px] font-bold text-ink outline-none"
          />
        </label>
      </div>

      {currentQuote ? (
        <div className="animate-fade-up mb-3 rounded-2xl border border-line bg-sand-50 p-3.5">
          <div className="mb-2 flex justify-between text-[13.5px] text-ink">
            <span>
              {arNum(pricePerNight)} د.إ × {arNum(currentQuote.nights)} ليلة
            </span>
            <span className="font-bold">{arNum(currentQuote.subtotal)}</span>
          </div>
          <div className="mb-2.5 flex justify-between text-[13.5px] text-muted">
            <span>رسوم الخدمة ({arNum(serviceFeePercent)}٪)</span>
            <span className="font-bold">{arNum(currentQuote.serviceFee)}</span>
          </div>
          <div className="flex justify-between border-t border-dashed border-line pt-2.5 font-display text-[16px] font-extrabold text-ink">
            <span>الإجمالي</span>
            <span>{arNum(currentQuote.total)} د.إ</span>
          </div>
          <p className="m-0 mt-2 text-[11.5px] text-muted">
            العربون {arNum(depositPercent)}٪ ({arNum(currentQuote.depositDue)} د.إ) عند تأكيد المالك
          </p>
        </div>
      ) : (
        <p className="m-0 mb-3 rounded-xl bg-gold-100 px-3 py-2.5 text-[12.5px] leading-relaxed text-bronze">
          اختر تاريخين من التقويم أعلاه لعرض السعر الإجمالي.
        </p>
      )}

      {ready ? (
        <Link
          href={href}
          className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-wa p-4 font-display text-[15.5px] font-extrabold text-wa-ink no-underline shadow-[0_10px_26px_rgb(37_211_102/0.26)] transition hover:brightness-105 hover:no-underline"
        >
          <Icon name="chat" size={21} />
          اطلب الحجز عبر الواتساب
        </Link>
      ) : (
        <a
          href="#availability"
          className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-sand-200 p-4 font-display text-[15.5px] font-extrabold text-muted no-underline hover:no-underline"
        >
          <Icon name="calendar_today" size={20} />
          اختر التواريخ أولًا
        </a>
      )}

      <p className="m-0 mt-2.5 text-center text-[12px] text-muted">
        لن يُخصم أي مبلغ الآن — سيتواصل معك المالك للتأكيد.
      </p>

      <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
        <span className="grid size-10.5 place-items-center rounded-full bg-sand-200 text-bronze">
          <Icon name="person" size={23} />
        </span>
        <span className="flex-1">
          <span className="block text-[14px] font-bold text-ink">{ownerName} — المالك</span>
          <span className="block text-[12px] font-semibold text-ok">
            إلغاء مجاني حتى {arNum(freeCancelHours)} ساعة
          </span>
        </span>
        <Icon name="verified" size={20} className="text-ok" />
      </div>
    </aside>
  );
}

/**
 * Mobile sticky action bar — the design's bottom bar on the detail screen.
 * Shown below `lg`, where the sidebar card is hidden.
 */
export function MobileBookingBar({
  slug,
  pricePerNight,
}: {
  slug: string;
  pricePerNight: number;
}) {
  const { range, currentQuote, bookingQuery } = useBooking();
  const ready = Boolean(range.checkIn && range.checkOut);
  const href = `/listings/${encodeURIComponent(slug)}/book${bookingQuery}`;

  const label = ready
    ? `${arDayMonth(range.checkIn!)} – ${arDayMonth(range.checkOut!)}`
    : "لم تُحدَّد التواريخ";

  return (
    <div className="sticky bottom-0 z-200 flex items-center gap-3 border-t border-line bg-surface/96 px-4 py-2.5 shadow-[0_-8px_26px_rgb(23_32_44/0.09)] backdrop-blur-lg lg:hidden">
      <div className="min-w-0 flex-1">
        <div>
          <span className="font-display text-[18px] font-extrabold text-ink">
            {arNum(currentQuote?.total ?? pricePerNight)}
          </span>
          <span className="text-[12px] font-semibold text-muted">
            {currentQuote ? " د.إ إجمالي" : " د.إ / ليلة"}
          </span>
        </div>
        <div className="truncate text-[11.5px] text-muted">{label}</div>
      </div>

      {ready ? (
        <Link
          href={href}
          className="flex items-center gap-2 rounded-2xl bg-wa px-5 py-3.5 font-display text-[14.5px] font-extrabold text-wa-ink no-underline shadow-[0_8px_20px_rgb(37_211_102/0.26)] hover:no-underline"
        >
          <Icon name="chat" size={19} />
          اطلب الحجز
        </Link>
      ) : (
        <a
          href="#availability"
          className="flex items-center gap-2 rounded-2xl bg-night-900 px-5 py-3.5 font-display text-[14.5px] font-extrabold text-sand-100 no-underline hover:no-underline"
        >
          <Icon name="calendar_today" size={19} />
          اختر التواريخ
        </a>
      )}
    </div>
  );
}
