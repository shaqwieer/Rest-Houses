"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import { TextInput } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { togglePublicHoliday } from "@/app/actions/public-holidays";
import { dayNamesShort } from "@/lib/constants";
import {
  arFullDate,
  arMonthLabel,
  buildMonthGrid,
  shiftMonth,
  todayISO,
  type ISODate,
} from "@/lib/dates";
import { useLocale } from "@/lib/i18n/provider";
import { arNum } from "@/lib/format";

/**
 * «التقويم الشامل» — tap a day to make it a public holiday for every rest house.
 *
 * Each tap fans out (or withdraws) a special day on every listing server-side;
 * the cell flips optimistically so marking a five-day Eid is five quick taps.
 */
export function PublicHolidaysEditor({
  holidays,
  listingCount,
  withoutRate,
}: {
  /** Upcoming holidays; `listings` = how many rest houses still carry it. */
  holidays: { id: string; date: ISODate; label: string; listings: number }[];
  listingCount: number;
  /** Listings whose `holidayPrice` is 0 — a holiday does not reprice them. */
  withoutRate: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { t, locale } = useLocale();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");

  const today = todayISO();
  const [view, setView] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { year: y, month: m - 1 };
  });

  const [marked, applyOptimistic] = useOptimistic(
    new Map(holidays.map((h) => [h.date, h.label] as const)),
    (current: Map<string, string>, entry: { date: string; label: string }) => {
      const next = new Map(current);
      if (next.has(entry.date)) next.delete(entry.date);
      else next.set(entry.date, entry.label);
      return next;
    },
  );

  const cells = buildMonthGrid(view.year, view.month, new Set(), today, locale);
  const atFirstMonth = (() => {
    const [y, m] = today.split("-").map(Number);
    return view.year === y && view.month === m - 1;
  })();

  function onToggle(date: ISODate) {
    startTransition(async () => {
      applyOptimistic({ date, label });
      const result = await togglePublicHoliday(date, label);
      toast(
        result.ok ? (result.message ?? t.common.saved) : result.error,
        result.ok ? "ok" : "error",
      );
      router.refresh();
    });
  }

  return (
    <div className="animate-fade-up">
      <h1 className="m-0 mb-1 font-display text-[20px] font-extrabold text-ink">
        {t.holidays.title}
      </h1>
      <p className="m-0 mb-4 text-[13.5px] leading-relaxed text-muted">{t.holidays.intro}</p>

      <label className="mb-3.5 flex flex-col gap-1.5 rounded-2xl border border-gold-500 bg-gold-100 p-3.5">
        <span className="text-[12.5px] font-bold text-bronze">{t.calendar.occasionName}</span>
        <TextInput
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t.calendar.occasionPlaceholder}
          maxLength={60}
          disabled={pending}
        />
        <span className="text-[12px] leading-relaxed text-bronze">{t.holidays.tapHint}</span>
      </label>

      <div className="rounded-[20px] border border-line bg-surface p-4 shadow-e1">
        <div className="mb-3.5 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setView((v) => shiftMonth(v.year, v.month, -1))}
            disabled={atFirstMonth}
            aria-label={t.listing.prevMonth}
            className="grid size-8.5 place-items-center rounded-xl border border-line text-ink disabled:opacity-35"
          >
            <Icon name="chevron_right" size={19} />
          </button>
          <span className="font-display text-[16px] font-extrabold text-ink">
            {arMonthLabel(view.year, view.month, locale)}
          </span>
          <button
            type="button"
            onClick={() => setView((v) => shiftMonth(v.year, v.month, 1))}
            aria-label={t.listing.nextMonth}
            className="grid size-8.5 place-items-center rounded-xl border border-line text-ink"
          >
            <Icon name="chevron_left" size={19} />
          </button>
        </div>

        <div className="mb-1.5 grid grid-cols-7 gap-1.5">
          {dayNamesShort(locale).map((d) => (
            <div key={d} className="text-center text-[10.5px] font-bold text-muted">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((cell) => {
            if (cell.kind === "blank") return <div key={cell.key} aria-hidden />;
            const holiday = marked.get(cell.iso);
            const isHoliday = holiday !== undefined;

            return (
              <button
                key={cell.key}
                type="button"
                onClick={() => onToggle(cell.iso)}
                disabled={cell.isPast || pending}
                aria-pressed={isHoliday}
                aria-label={`${cell.dayNumber}${
                  isHoliday ? ` — ${holiday || t.holidays.publicHoliday}` : ""
                }`}
                title={isHoliday ? holiday || t.holidays.publicHoliday : undefined}
                className={clsx(
                  "relative flex h-11 flex-col items-center justify-center rounded-[10px] border text-[13px] font-bold leading-none transition",
                  cell.isPast && "cursor-not-allowed border-[#EFE9DC] bg-[#F8F5EE] text-off",
                  !cell.isPast &&
                    isHoliday &&
                    "cursor-pointer border-gold-500 bg-gold-100 text-bronze ring-2 ring-inset ring-gold-500",
                  !cell.isPast &&
                    !isHoliday &&
                    "cursor-pointer border-line bg-surface text-ink hover:border-gold-500 hover:bg-gold-100",
                )}
              >
                <span>{cell.label}</span>
                {cell.hijri && (
                  <span className="mt-0.5 text-[8.5px] font-medium opacity-50">{cell.hijri}</span>
                )}
                {isHoliday && !cell.isPast && (
                  <span
                    aria-hidden
                    className="absolute bottom-0.5 text-[8px] leading-none text-gold-600"
                  >
                    ★
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Upcoming holidays */}
      <section className="mt-4 rounded-[20px] border border-line bg-surface p-4 shadow-e1">
        <h2 className="m-0 mb-3 flex items-center gap-2 font-display text-[16px] font-extrabold text-ink">
          <Icon name="celebration" size={19} className="text-bronze" />
          {t.holidays.upcoming}
        </h2>
        {holidays.length === 0 ? (
          <p className="m-0 text-[13px] text-muted">{t.holidays.none}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {holidays.map((h) => (
              <li
                key={h.id}
                className="flex items-center gap-3 rounded-2xl border border-line bg-sand-50 px-3.5 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-bold text-ink">
                    {h.label || t.holidays.publicHoliday}
                  </div>
                  <div className="text-[12px] text-muted">
                    {arFullDate(h.date, locale)} ·{" "}
                    {t.holidays.appliedTo(arNum(h.listings, locale), arNum(listingCount, locale))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onToggle(h.date)}
                  disabled={pending}
                  aria-label={t.holidays.remove}
                  title={t.holidays.remove}
                  className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-muted transition hover:border-busy hover:text-busy disabled:opacity-50"
                >
                  <Icon name="close" size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Listings a holiday will not reprice */}
      {withoutRate.length > 0 && (
        <section className="mt-4 rounded-[20px] border border-busy bg-busy-bg p-4">
          <h2 className="m-0 mb-1 font-display text-[15px] font-extrabold text-busy">
            {t.holidays.noRateTitle(arNum(withoutRate.length, locale))}
          </h2>
          <p className="m-0 mb-3 text-[12.5px] leading-relaxed text-ink">{t.holidays.noRateBody}</p>
          <div className="flex flex-wrap gap-2">
            {withoutRate.map((l) => (
              <Link
                key={l.id}
                href={`/admin/listings/${l.id}`}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-ink no-underline hover:border-gold-500 hover:no-underline"
              >
                {l.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="mt-4 mb-0 flex items-start gap-2 rounded-2xl bg-gold-100 px-4 py-3.5 text-[12.5px] leading-relaxed text-bronze">
        <Icon name="info" size={18} className="shrink-0" />
        <span>{t.holidays.ownerNote}</span>
      </p>
    </div>
  );
}
