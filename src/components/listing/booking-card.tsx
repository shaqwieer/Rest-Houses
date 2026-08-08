"use client";

import Link from "next/link";
import { useState } from "react";
import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import { useBooking } from "./booking-context";
import { AvailabilityCalendar, type DateRange } from "./availability-calendar";
import { arDayMonth } from "@/lib/dates";
import { arNum } from "@/lib/format";
import { useLocale } from "@/lib/i18n/provider";
import type { ResolvedCancelPolicy } from "@/lib/policies";

/** The calendar section in the main column. Reads/writes the shared selection. */
export function CalendarSection({
  checkIn,
  checkOut,
  dayUseCheckOutTime,
  datesTaken = false,
}: {
  checkIn: string;
  checkOut: string;
  /** The hour a day guest must leave by, in the visitor's language. "" hides it. */
  dayUseCheckOutTime: string;
  /**
   * The guest was sent back here because somebody else took their dates while
   * they were filling in the booking form — `?unavailable=1`, set by the
   * redirect in listings/[slug]/book/page.tsx.
   */
  datesTaken?: boolean;
}) {
  const {
    range,
    setRange,
    unavailableDates,
    stayType,
    setStayType,
    dayUseAvailable,
    weekendMode,
  } = useBooking();
  const { t } = useLocale();
  const isDayUse = stayType === "dayUse";

  // The notice describes the selection the guest arrived with, so it stops
  // being true the moment they touch the calendar. Keeping it on screen after
  // that would leave a red warning sitting above dates that are perfectly
  // available — and the flag stays in the URL, so nothing else would clear it.
  const [dismissed, setDismissed] = useState(false);
  const showTakenNotice = datesTaken && !dismissed;

  function chooseRange(next: DateRange) {
    setDismissed(true);
    setRange(next);
  }

  return (
    <section id="availability" className="border-b border-line py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3.5">
        <div>
          <h2 className="m-0 mb-1 font-display text-[19px] font-extrabold text-ink">
            {t.listing.availabilityTitle}
          </h2>
          <p className="m-0 text-[13.5px] text-muted">
            {isDayUse ? t.listing.dayUsePickOneDay : t.listing.availabilitySubtitle}
          </p>
        </div>
        <p className="m-0 text-[12.5px] text-muted">
          {isDayUse
            ? dayUseCheckOutTime
              ? t.listing.dayUseLeaveBy(dayUseCheckOutTime)
              : ""
            : t.listing.checkInOut(checkIn, checkOut)}
        </p>
      </div>

      {/* Somebody else took these dates between the calendar and the form. It
          is announced as an alert rather than shown as a passive note: the
          guest believed they had a booking in progress, and being returned to
          a calendar with no explanation reads as the site having lost it. */}
      {showTakenNotice && (
        <p
          role="alert"
          className="m-0 mb-3 flex items-start gap-2 rounded-xl border border-busy bg-busy-bg px-3.5 py-3 text-[13px] font-semibold text-busy"
        >
          <Icon name="error" size={18} className="mt-0.5 shrink-0" />
          {t.validation.datesTaken}
        </p>
      )}

      {/* ---- stay type ----
          Rendered only when the owner has set a day rate; a listing that does
          not offer day bookings shows exactly the calendar it always did.
          Switching clears the selection — see `setStayType` in the provider. */}
      {dayUseAvailable && (
        <div
          role="radiogroup"
          aria-label={t.listing.stayType}
          className="mb-3 flex gap-1.5 rounded-2xl bg-sand-100 p-1"
        >
          {/* Switching the stay type clears the selection, so the notice about
              the old one stops applying then too. */}
          <StayTypeButton
            active={!isDayUse}
            onClick={() => {
              setDismissed(true);
              setStayType("overnight");
            }}
            icon="cabin"
            label={t.listing.stayOvernight}
          />
          <StayTypeButton
            active={isDayUse}
            onClick={() => {
              setDismissed(true);
              setStayType("dayUse");
            }}
            icon="schedule"
            label={t.listing.stayDayUse}
          />
        </div>
      )}

      <AvailabilityCalendar
        unavailableDates={unavailableDates}
        value={range}
        onChange={chooseRange}
        months={2}
        singleDay={isDayUse}
        weekendMode={weekendMode}
      />
    </section>
  );
}

function StayTypeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: "cabin" | "schedule";
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={clsx(
        "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[13px] font-bold transition",
        active
          ? "bg-surface text-ink shadow-e1"
          : "bg-transparent text-muted hover:text-bronze",
      )}
    >
      <Icon name={icon} size={17} />
      {label}
    </button>
  );
}

/**
 * Sticky price + request card (desktop) — the design's `bookCardStyle` aside.
 *
 * The button navigates to the booking form carrying the selection in the URL,
 * rather than posting from here. That way the form page can be deep-linked, the
 * selection survives a refresh, and the server re-validates the dates against
 * the calendar before anything is written.
 *
 * ─── Deposit ─────────────────────────────────────────────────────────────────
 * `depositPercent` arrives already resolved by the page (the listing's own rate,
 * falling back to the platform default only when it has none set). The figure
 * shown here is a preview computed client-side for responsiveness; the amount
 * that is stored and quoted is recomputed on the server inside
 * `createBookingRequest`, which trusts nothing this component produced.
 */
export function BookingCard({
  slug,
  pricePerNight,
  weekendPrice,
  capacity,
  ownerName,
  serviceFeePercent,
  depositPercent,
  securityDeposit,
  cancel,
  ownerWhatsappHref,
}: {
  slug: string;
  pricePerNight: number;
  weekendPrice: number;
  capacity: number;
  ownerName: string;
  serviceFeePercent: number;
  depositPercent: number;
  /** Refundable, collected by the owner. 0 hides the line. */
  securityDeposit: number;
  cancel: ResolvedCancelPolicy;
  /** "" when this listing has no usable WhatsApp number — hides the button. */
  ownerWhatsappHref: string;
}) {
  const { range, guests, setGuests, currentQuote, bookingQuery, ready, stayType } =
    useBooking();
  const { t, locale } = useLocale();
  const isDayUse = stayType === "dayUse";

  const href = `/listings/${encodeURIComponent(slug)}/book${bookingQuery}`;

  // One date for a day booking, two for a stay. Reading `stayType` rather than
  // testing whether the two dates are equal: an incomplete overnight selection
  // looks the same from the outside, and would render "pick a check-out" on a
  // finished day booking.
  const rangeLabel = isDayUse
    ? range.checkIn
      ? arDayMonth(range.checkIn, locale)
      : t.listing.dayUsePickDay
    : range.checkIn
      ? range.checkOut
        ? `${arDayMonth(range.checkIn, locale)} – ${arDayMonth(range.checkOut, locale)}`
        : t.listing.pickCheckOut
      : t.listing.pickCheckIn;

  return (
    <aside className="hidden lg:sticky lg:top-[150px] lg:block lg:rounded-[28px] lg:border lg:border-sand-300 lg:bg-surface lg:p-5.5 lg:shadow-e2">
      <div className="mb-1 flex items-end justify-between gap-2.5">
        <div>
          <span className="font-display text-[26px] font-extrabold text-ink">
            {arNum(pricePerNight, locale)}
          </span>
          <span className="text-[13px] font-semibold text-muted">
            {" "}
            {t.common.aed} {t.common.perNight}
          </span>
        </div>
        {weekendPrice > pricePerNight && (
          <span className="text-[12px] text-muted">
            {t.listing.weekendRate(arNum(weekendPrice, locale))}
          </span>
        )}
      </div>

      <div className="my-4 h-px bg-line" />

      <div className="mb-2.5 grid grid-cols-2 gap-2">
        <div className="rounded-[13px] border border-line bg-sand-50 px-3 py-2.5">
          <span className="mb-0.5 block text-[11px] font-bold text-bronze">
            {t.listing.dates}
          </span>
          <span className="block text-[13.5px] font-bold text-ink">{rangeLabel}</span>
        </div>
        <label className="rounded-[13px] border border-line bg-sand-50 px-3 py-2.5">
          <span className="mb-0.5 block text-[11px] font-bold text-bronze">
            {t.listing.guests}
          </span>
          <input
            type="number"
            min={1}
            max={capacity}
            value={guests}
            onChange={(e) => setGuests(Number(e.target.value) || 1)}
            aria-label={t.listing.guestCount}
            className="w-full border-0 bg-transparent p-0 text-[13.5px] font-bold text-ink outline-none"
          />
        </label>
      </div>

      {currentQuote ? (
        <div className="animate-fade-up mb-3 rounded-2xl border border-line bg-sand-50 p-3.5">
          <div className="mb-2 flex justify-between text-[13.5px] text-ink">
            {/* A day booking has no nights to count, so it names itself rather
                than rendering "0 nights × price" — which is both wrong and the
                exact phrasing that would make a guest think the form broke. */}
            <span>
              {currentQuote.dayUse
                ? t.listing.dayUseLine
                : t.listing.nightsLine(
                    arNum(pricePerNight, locale),
                    arNum(currentQuote.nights, locale),
                    currentQuote.nights,
                  )}
            </span>
            <span className="font-bold">{arNum(currentQuote.subtotal, locale)}</span>
          </div>
          {/* The platform charges no service fee, so this row is normally
              absent and the total is simply the nights. It is still rendered
              when an operator has set a fee from /admin/settings — a charge
              that exists must be itemised, and one that doesn't must not be
              shown as "0". */}
          {serviceFeePercent > 0 && (
            <div className="mb-2.5 flex justify-between text-[13.5px] text-muted">
              <span>{t.listing.serviceFee(arNum(serviceFeePercent, locale))}</span>
              <span className="font-bold">{arNum(currentQuote.serviceFee, locale)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-dashed border-line pt-2.5 font-display text-[16px] font-extrabold text-ink">
            <span>{t.listing.total}</span>
            <span>
              {arNum(currentQuote.total, locale)} {t.common.aed}
            </span>
          </div>
          {/* Both the total and the deposit are shown, as required — a guest
              should never have to work out what they will actually be asked
              for up front. */}
          <p className="m-0 mt-2 text-[11.5px] text-muted">
            {depositPercent > 0
              ? t.listing.depositLine(
                  arNum(depositPercent, locale),
                  arNum(currentQuote.depositDue, locale),
                )
              : t.listing.noDepositLine}
          </p>
          {/* Below the total, never inside it: this money comes back after the
              stay, so folding it into the headline figure would overstate what
              the booking costs. */}
          {securityDeposit > 0 && (
            <p className="m-0 mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-bronze">
              <Icon name="shield" size={15} className="mt-0.5 shrink-0" />
              {t.listing.securityDepositLine(arNum(securityDeposit, locale))}
            </p>
          )}
        </div>
      ) : (
        <p className="m-0 mb-3 rounded-xl bg-gold-100 px-3 py-2.5 text-[12.5px] leading-relaxed text-bronze">
          {t.listing.pickDatesHint}
        </p>
      )}

      {ready ? (
        <Link
          href={href}
          className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-wa p-4 font-display text-[15.5px] font-extrabold text-wa-ink no-underline shadow-[0_10px_26px_rgb(37_211_102/0.26)] transition hover:brightness-105 hover:no-underline"
        >
          <Icon name="chat" size={21} />
          {t.listing.requestViaWhatsapp}
        </Link>
      ) : (
        <a
          href="#availability"
          className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-sand-200 p-4 font-display text-[15.5px] font-extrabold text-muted no-underline hover:no-underline"
        >
          <Icon name="calendar_today" size={20} />
          {t.listing.pickDatesFirst}
        </a>
      )}

      <p className="m-0 mt-2.5 text-center text-[12px] text-muted">{t.listing.noChargeNow}</p>

      <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
        <span className="grid size-10.5 place-items-center rounded-full bg-sand-200 text-bronze">
          <Icon name="person" size={23} />
        </span>
        <span className="flex-1">
          <span className="block text-[14px] font-bold text-ink">
            {t.listing.ownerLabel(ownerName)}
          </span>
          {/* This is the reassuring green line, so it only appears when there
              is something reassuring to say. An owner who allows no free
              cancellation, or who wants to be asked, gets no line at all rather
              than a green one carrying a caveat — the terms are stated in full
              in the key-facts row above. */}
          {cancel.kind === "hours" && (
            <span className="block text-[12px] font-semibold text-ok">
              {t.listing.freeCancel(arNum(cancel.hours, locale))}
            </span>
          )}
        </span>
        <Icon name="verified" size={20} className="text-ok" />
      </div>

      {/* Direct line to *this listing's owner*, separate from the booking
          request. Rendered only when the listing actually resolves to a number,
          so an owned listing whose owner has none shows nothing rather than a
          link to the platform's number. */}
      {ownerWhatsappHref && (
        <a
          href={ownerWhatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-wa/40 p-3 text-[13.5px] font-bold text-wa no-underline transition hover:bg-wa/10 hover:no-underline"
        >
          <Icon name="chat" size={18} />
          {t.listing.contactOwnerWhatsapp}
        </a>
      )}
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
  const { range, currentQuote, bookingQuery, ready, stayType } = useBooking();
  const { t, locale } = useLocale();
  const isDayUse = stayType === "dayUse";

  const href = `/listings/${encodeURIComponent(slug)}/book${bookingQuery}`;

  // `ready` comes from the provider, which knows a day booking needs one date
  // and a stay needs two. Deriving it here from `checkIn && checkOut` again
  // happened to work — the provider pins them equal for a day booking — but it
  // is the same fact stated twice, and the second copy is the one that rots.
  const dateLabel = !ready
    ? t.listing.noDatesChosen
    : isDayUse
      ? arDayMonth(range.checkIn!, locale)
      : `${arDayMonth(range.checkIn!, locale)} – ${arDayMonth(range.checkOut!, locale)}`;

  return (
    <div className="sticky bottom-0 z-200 flex items-center gap-3 border-t border-line bg-surface/96 px-4 py-2.5 shadow-[0_-8px_26px_rgb(23_32_44/0.09)] backdrop-blur-lg lg:hidden">
      <div className="min-w-0 flex-1">
        <div>
          <span className="font-display text-[18px] font-extrabold text-ink">
            {arNum(currentQuote?.total ?? pricePerNight, locale)}
          </span>
          <span className="text-[12px] font-semibold text-muted">
            {currentQuote
              ? t.listing.totalSuffix
              : isDayUse
                ? t.listing.perDaySuffix
                : t.listing.perNightSuffix}
          </span>
        </div>
        <div className="truncate text-[11.5px] text-muted">{dateLabel}</div>
      </div>

      {ready ? (
        <Link
          href={href}
          className="flex items-center gap-2 rounded-2xl bg-wa px-5 py-3.5 font-display text-[14.5px] font-extrabold text-wa-ink no-underline shadow-[0_8px_20px_rgb(37_211_102/0.26)] hover:no-underline"
        >
          <Icon name="chat" size={19} />
          {t.listing.requestBooking}
        </Link>
      ) : (
        <a
          href="#availability"
          className="flex items-center gap-2 rounded-2xl bg-night-900 px-5 py-3.5 font-display text-[14.5px] font-extrabold text-sand-100 no-underline hover:no-underline"
        >
          <Icon name="calendar_today" size={19} />
          {t.listing.pickDates}
        </a>
      )}
    </div>
  );
}
