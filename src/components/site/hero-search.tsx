"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { CITIES } from "@/lib/constants";
import { addDays, todayISO } from "@/lib/dates";

/**
 * Hero search bar: destination, dates, guests.
 *
 * A real `<form>` that navigates to /listings with query params, so a search is
 * a shareable, bookmarkable URL and works even if the JS bundle hasn't loaded.
 * The date inputs are native `type="date"` — on a phone that opens the OS date
 * picker, which is more usable (and more accessible) than any custom widget,
 * and it's the same control the design's mock date fields stood in for.
 */
export function HeroSearch() {
  const router = useRouter();
  const today = todayISO();

  const [city, setCity] = useState("all");
  const [checkIn, setCheckIn] = useState(addDays(today, 3));
  const [checkOut, setCheckOut] = useState(addDays(today, 5));
  const [guests, setGuests] = useState(30);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (city !== "all") params.set("city", city);
    if (checkIn) params.set("from", checkIn);
    if (checkOut) params.set("to", checkOut);
    if (guests > 0) params.set("capacity", String(guests));
    router.push(`/listings?${params.toString()}`);
  }

  // Check-out must be after check-in; nudge it forward if the guest crosses over.
  function onCheckIn(value: string) {
    setCheckIn(value);
    if (value && checkOut && checkOut <= value) setCheckOut(addDays(value, 1));
  }

  const cellBase =
    "flex cursor-pointer flex-col gap-0.5 rounded-[20px] px-4 py-3 transition hover:bg-sand-100";
  const labelBase = "text-[11.5px] font-bold tracking-wide text-bronze";
  const valueBase =
    "flex items-center gap-2 text-[15px] font-semibold text-ink [&_input]:w-full [&_input]:border-0 [&_input]:bg-transparent [&_input]:p-0 [&_input]:text-[15px] [&_input]:font-semibold [&_input]:text-ink [&_input]:outline-none [&_select]:w-full [&_select]:cursor-pointer [&_select]:border-0 [&_select]:bg-transparent [&_select]:p-0 [&_select]:text-[15px] [&_select]:font-semibold [&_select]:text-ink [&_select]:outline-none";

  return (
    <form
      onSubmit={submit}
      className="grid items-stretch gap-1 rounded-[28px] border border-gold-500/30 bg-surface/97 p-2.5 shadow-[0_30px_70px_rgb(0_0_0/0.4)] sm:grid-cols-2 lg:grid-cols-[repeat(4,1fr)_auto]"
    >
      <label className={cellBase}>
        <span className={labelBase}>الوجهة</span>
        <span className={valueBase}>
          <Icon name="location_on" size={19} className="text-gold-600" />
          <select value={city} onChange={(e) => setCity(e.target.value)} aria-label="الوجهة">
            <option value="all">كل الإمارات</option>
            {CITIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.ar}
              </option>
            ))}
          </select>
        </span>
      </label>

      <label className={`${cellBase} sm:border-e sm:border-line`}>
        <span className={labelBase}>تاريخ الوصول</span>
        <span className={valueBase}>
          <Icon name="calendar_today" size={19} className="text-gold-600" />
          <input
            type="date"
            value={checkIn}
            min={today}
            onChange={(e) => onCheckIn(e.target.value)}
            aria-label="تاريخ الوصول"
          />
        </span>
      </label>

      <label className={`${cellBase} lg:border-e lg:border-line`}>
        <span className={labelBase}>تاريخ المغادرة</span>
        <span className={valueBase}>
          <Icon name="event" size={19} className="text-gold-600" />
          <input
            type="date"
            value={checkOut}
            min={checkIn ? addDays(checkIn, 1) : today}
            onChange={(e) => setCheckOut(e.target.value)}
            aria-label="تاريخ المغادرة"
          />
        </span>
      </label>

      <label className={`${cellBase} sm:border-e sm:border-line`}>
        <span className={labelBase}>عدد الضيوف</span>
        <span className={valueBase}>
          <Icon name="group" size={19} className="text-gold-600" />
          <input
            type="number"
            min={1}
            max={500}
            value={guests}
            onChange={(e) => setGuests(Math.max(1, Number(e.target.value) || 1))}
            aria-label="عدد الضيوف"
          />
        </span>
      </label>

      <button
        type="submit"
        className="flex items-center justify-center gap-2.5 rounded-[20px] bg-linear-[140deg,var(--gold-500),var(--gold-600)] px-6 py-4 font-display text-[16px] font-extrabold text-night-900 shadow-gold transition hover:brightness-105 active:translate-y-px sm:col-span-2 lg:col-span-1"
      >
        <Icon name="search" size={21} />
        ابحث
      </button>
    </form>
  );
}
