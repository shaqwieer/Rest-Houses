"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { CITIES, label } from "@/lib/constants";
import { addDays, todayISO } from "@/lib/dates";
import { useLocale } from "@/lib/i18n/provider";
import { EMPTY_HERO_SEARCH, heroSearchHref, type HeroSearchState } from "@/lib/search";

/**
 * Hero search bar: destination, dates, guests.
 *
 * A real `<form>` that navigates to /listings with query params, so a search is
 * a shareable, bookmarkable URL and works even if the JS bundle hasn't loaded.
 * The date inputs are native `type="date"` — on a phone that opens the OS date
 * picker, which is more usable (and more accessible) than any custom widget.
 *
 * ─── Every field starts open ─────────────────────────────────────────────────
 * No emirate, no dates, any number of guests — see `EMPTY_HERO_SEARCH` for what
 * the old pre-filled 30 guests and dates did to an untouched search. Pressing
 * «ابحث» without changing anything now opens the whole catalogue, and only
 * what the visitor actually set goes into the URL (`heroSearchHref`).
 *
 * ─── Layout ──────────────────────────────────────────────────────────────────
 * On a phone the bar is three short rows — where and how many, then the two
 * dates, then the button — instead of five full-width ones, so the listings
 * below it start on the first screen. From `lg` it is the single row it always
 * was, in reading order.
 */
export function HeroSearch() {
  const router = useRouter();
  const { t, locale } = useLocale();
  const today = todayISO();

  const [search, setSearch] = useState<HeroSearchState>(EMPTY_HERO_SEARCH);
  const set = (patch: Partial<HeroSearchState>) => setSearch((s) => ({ ...s, ...patch }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    router.push(heroSearchHref(search));
  }

  // Check-out must be after check-in; nudge it forward if the guest crosses
  // over, and offer one night when they pick an arrival with no departure yet.
  function onCheckIn(value: string) {
    const { checkOut } = search;
    set({
      checkIn: value,
      checkOut: value && (!checkOut || checkOut <= value) ? addDays(value, 1) : checkOut,
    });
  }

  const cellBase =
    "relative flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-[16px] border border-line bg-sand-50 px-3.5 py-2.5 transition hover:bg-sand-100 lg:rounded-[20px] lg:border-0 lg:bg-transparent lg:px-4 lg:py-3";
  const labelBase = "text-[11.5px] font-bold tracking-wide text-bronze";
  const valueBase =
    "relative flex min-w-0 items-center gap-2 text-[15px] font-semibold text-ink [&_input]:w-full [&_input]:min-w-0 [&_input]:border-0 [&_input]:bg-transparent [&_input]:p-0 [&_input]:text-[15px] [&_input]:font-semibold [&_input]:text-ink [&_input]:outline-none [&_select]:w-full [&_select]:min-w-0 [&_select]:cursor-pointer [&_select]:border-0 [&_select]:bg-transparent [&_select]:p-0 [&_select]:text-[15px] [&_select]:font-semibold [&_select]:text-ink [&_select]:outline-none";

  /**
   * A date field that says «أي تاريخ» while it is empty.
   *
   * Native date inputs have no placeholder: an empty one renders the browser's
   * own "mm/dd/yyyy" mask, in English, which reads as a value on a phone. The
   * mask is hidden (not removed — the input is still what receives the tap)
   * and the label sits over it until the field is focused or filled.
   *
   * The browser's own calendar glyph is hidden too — it sat on top of the
   * label, and the gold icon beside the field already says "date" — so a tap
   * anywhere on the field opens the picker through `showPicker()`, which is
   * what the glyph did. Where `showPicker` is missing (older Safari) the field
   * still takes focus and the OS opens its own picker, as it always did.
   */
  const dateField = (
    value: string,
    min: string,
    onChange: (v: string) => void,
    aria: string,
  ) => (
    <>
      <input
        type="date"
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker?.();
          } catch {
            // Refused outside a user gesture, or already open — nothing to do.
          }
        }}
        aria-label={aria}
        className={`peer cursor-pointer [&::-webkit-calendar-picker-indicator]:hidden ${
          value ? "" : "text-transparent! focus:text-ink!"
        }`}
      />
      {!value && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 start-7 flex items-center text-[15px] font-semibold text-muted peer-focus:hidden"
        >
          {t.listings.anyDate}
        </span>
      )}
    </>
  );

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-2 items-stretch gap-2 rounded-[24px] border border-gold-500/30 bg-surface/97 p-2.5 shadow-[0_30px_70px_rgb(0_0_0/0.4)] lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:gap-1 lg:rounded-[28px]"
    >
      <label className={`${cellBase} lg:border-e lg:border-line`}>
        <span className={labelBase}>{t.listings.destination}</span>
        <span className={valueBase}>
          <Icon name="location_on" size={19} className="shrink-0 text-gold-600" />
          <select
            value={search.city}
            onChange={(e) => set({ city: e.target.value })}
            aria-label={t.listings.destination}
          >
            <option value="all">{t.listings.allCities}</option>
            {CITIES.map((c) => (
              <option key={c.id} value={c.id}>
                {label(c, locale)}
              </option>
            ))}
          </select>
        </span>
      </label>

      {/* Second on a phone, beside the destination; last of the four on a
          desktop row, where it has always been. */}
      <label className={`${cellBase} lg:order-4`}>
        <span className={labelBase}>{t.booking.guestCount}</span>
        <span className={valueBase}>
          <Icon name="group" size={19} className="shrink-0 text-gold-600" />
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={500}
            value={search.guests}
            placeholder={t.listings.anyCapacity}
            onChange={(e) => set({ guests: e.target.value })}
            aria-label={t.booking.guestCount}
            className="placeholder:text-muted"
          />
        </span>
      </label>

      <label className={`${cellBase} lg:order-2 lg:border-e lg:border-line`}>
        <span className={labelBase}>{t.booking.checkInDate}</span>
        <span className={valueBase}>
          <Icon name="calendar_today" size={19} className="shrink-0 text-gold-600" />
          {dateField(search.checkIn, today, onCheckIn, t.booking.checkInDate)}
        </span>
      </label>

      <label className={`${cellBase} lg:order-3 lg:border-e lg:border-line`}>
        <span className={labelBase}>{t.booking.checkOutDate}</span>
        <span className={valueBase}>
          <Icon name="event" size={19} className="shrink-0 text-gold-600" />
          {dateField(
            search.checkOut,
            search.checkIn ? addDays(search.checkIn, 1) : today,
            (v) => set({ checkOut: v }),
            t.booking.checkOutDate,
          )}
        </span>
      </label>

      <button
        type="submit"
        className="col-span-2 flex items-center justify-center gap-2.5 rounded-[18px] bg-linear-[140deg,var(--gold-500),var(--gold-600)] px-6 py-3.5 font-display text-[16px] font-extrabold text-night-900 shadow-gold transition hover:brightness-105 active:translate-y-px lg:order-5 lg:col-span-1 lg:rounded-[20px] lg:py-4"
      >
        <Icon name="search" size={21} />
        {t.listings.searchButton}
      </button>
    </form>
  );
}
