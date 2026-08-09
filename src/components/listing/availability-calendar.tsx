"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/lib/i18n/provider";
import { dayNames, dayNamesShort } from "@/lib/constants";
import {
  addDays,
  arMonthLabel,
  buildMonthGrid,
  DEFAULT_WEEKEND_MODE,
  nightsInRange,
  parseISODate,
  shiftMonth,
  todayISO,
  type ISODate,
  type WeekendMode,
} from "@/lib/dates";

/**
 * Guest-facing availability calendar with range selection.
 *
 * Unavailable days come from the server as ISO date strings, so a day the owner
 * blocked is the *same* day for every visitor regardless of timezone — see the
 * header comment in src/lib/dates.ts for why this matters.
 *
 * Selection rules, matching the design:
 *   • first click sets check-in, second sets check-out
 *   • clicking a day at or before the current check-in restarts the selection
 *   • a range containing any unavailable night is rejected (you can't book
 *     around a booked night)
 */

export type DateRange = { checkIn: ISODate | null; checkOut: ISODate | null };

export function AvailabilityCalendar({
  unavailableDates,
  value,
  onChange,
  /** Number of months to render side by side from `md:` up. */
  months = 1,
  /**
   * Single-day selection, for a day booking (حجز بدون مبيت).
   *
   * One click completes the selection: the day becomes both check-in and
   * check-out. The two-click range logic below is skipped entirely rather than
   * being coaxed into producing an equal pair — a "range" of one day would
   * otherwise be indistinguishable from a half-finished overnight selection,
   * and the prompt at the bottom would keep asking for a check-out that is
   * never coming.
   */
  singleDay = false,
  /**
   * The listing's weekend, so the shaded cells are the days it actually charges
   * the weekend rate for. A Sharjah listing prices Friday as a weekend night;
   * leaving Friday plain here while the sidebar quotes the weekend rate for it
   * is the page contradicting itself in front of the guest.
   */
  weekendMode = DEFAULT_WEEKEND_MODE,
  /**
   * Nights the owner marked as a big occasion, date → occasion name.
   *
   * Shown so a guest learns *before* picking the dates that Eid costs more,
   * rather than watching the total jump once the range is set. The rate itself
   * is applied by `quote()`; this only marks the cells.
   */
  specialDays,
}: {
  unavailableDates: ISODate[];
  value: DateRange;
  onChange: (next: DateRange) => void;
  months?: number;
  singleDay?: boolean;
  weekendMode?: WeekendMode;
  specialDays?: ReadonlyMap<ISODate, string>;
}) {
  const today = todayISO();
  const unavailable = useMemo(() => new Set(unavailableDates), [unavailableDates]);

  const { t, locale } = useLocale();
  const [view, setView] = useState(() => {
    const d = parseISODate(value.checkIn ?? today);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  });

  const grids = useMemo(
    () =>
      Array.from({ length: months }, (_, i) => {
        const { year, month } = shiftMonth(view.year, view.month, i);
        return {
          year,
          month,
          cells: buildMonthGrid(year, month, unavailable, today, locale, weekendMode),
        };
      }),
    [view, months, unavailable, today, locale, weekendMode],
  );

  /** True if any night in [start, end) is blocked. */
  function rangeHasClash(start: ISODate, end: ISODate): boolean {
    return nightsInRange(start, end).some((d) => unavailable.has(d));
  }

  function pick(iso: ISODate) {
    const { checkIn, checkOut } = value;

    // A day booking is one click. The day is both ends of the stay, which is
    // what the server requires of a day-use request (`checkOut === checkIn`).
    if (singleDay) {
      onChange({ checkIn: iso, checkOut: iso });
      return;
    }

    // No selection yet, or a complete range → start over from this day.
    if (!checkIn || checkOut) {
      onChange({ checkIn: iso, checkOut: null });
      return;
    }

    // Clicking backwards restarts rather than inverting the range.
    if (iso <= checkIn) {
      onChange({ checkIn: iso, checkOut: null });
      return;
    }

    // Completing the range: refuse if it would span a blocked night.
    if (rangeHasClash(checkIn, iso)) {
      onChange({ checkIn: iso, checkOut: null });
      return;
    }

    onChange({ checkIn, checkOut: iso });
  }

  // Can't page back before the current month.
  const atFirstMonth =
    view.year === parseISODate(today).getUTCFullYear() &&
    view.month === parseISODate(today).getUTCMonth();

  return (
    <div className="rounded-[20px] border border-line bg-surface p-4 shadow-e1">
      {/* month nav */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setView((v) => shiftMonth(v.year, v.month, -1))}
          disabled={atFirstMonth}
          aria-label={t.listing.prevMonth}
          className="grid size-8.5 place-items-center rounded-xl border border-line bg-surface text-ink transition enabled:hover:border-gold-500 disabled:opacity-35"
        >
          {/* In RTL, "previous" points right. */}
          <Icon name="chevron_right" size={19} />
        </button>

        <span className="min-w-30 text-center font-display text-[15px] font-bold text-ink">
          {grids.length > 1
            ? `${arMonthLabel(grids[0].year, grids[0].month, locale)} — ${arMonthLabel(
                grids[grids.length - 1].year,
                grids[grids.length - 1].month,
                locale,
              )}`
            : arMonthLabel(view.year, view.month, locale)}
        </span>

        <button
          type="button"
          onClick={() => setView((v) => shiftMonth(v.year, v.month, 1))}
          aria-label={t.listing.nextMonth}
          className="grid size-8.5 place-items-center rounded-xl border border-line bg-surface text-ink transition hover:border-gold-500"
        >
          <Icon name="chevron_left" size={19} />
        </button>
      </div>

      <div className={clsx("grid gap-5", months > 1 && "md:grid-cols-2")}>
        {grids.map((g) => (
          <div key={`${g.year}-${g.month}`}>
            {months > 1 && (
              <div className="mb-2 text-center font-display text-[13.5px] font-bold text-bronze">
                {arMonthLabel(g.year, g.month, locale)}
              </div>
            )}

            {/* weekday header */}
            <div className="mb-1.5 grid grid-cols-7 gap-1.5">
              {dayNames(locale).map((d, i) => (
                <div
                  key={d}
                  className="py-1 text-center text-[11px] font-bold text-muted"
                  // Full names don't fit at phone widths; abbreviate there.
                  title={d}
                >
                  <span className="sm:hidden">{dayNamesShort(locale)[i]}</span>
                  <span className="hidden sm:inline">{d}</span>
                </div>
              ))}
            </div>

            {/* days */}
            <div className="grid grid-cols-7 gap-1.5">
              {g.cells.map((cell) => {
                if (cell.kind === "blank") {
                  return <div key={cell.key} aria-hidden />;
                }

                const isStart = value.checkIn === cell.iso;
                const isEnd = value.checkOut === cell.iso;
                const inRange =
                  value.checkIn !== null &&
                  value.checkOut !== null &&
                  cell.iso > value.checkIn &&
                  cell.iso < value.checkOut;

                const disabled = cell.isPast || cell.isUnavailable;
                const occasion = specialDays?.get(cell.iso);
                // A past occasion is history and marking it only adds noise.
                const isSpecial = occasion !== undefined && !cell.isPast;

                return (
                  <button
                    key={cell.key}
                    type="button"
                    onClick={() => pick(cell.iso)}
                    disabled={disabled}
                    aria-label={`${cell.dayNumber}${
                  cell.isUnavailable ? ` — ${t.listing.dayBooked}` : ""
                }${isSpecial ? ` — ${occasion || t.listing.occasionNight}` : ""}`}
                    title={isSpecial ? occasion || t.listing.occasionNight : undefined}
                    aria-pressed={isStart || isEnd}
                    className={clsx(
                      "relative flex h-11.5 flex-col items-center justify-center rounded-xl border text-[14px] font-bold leading-none transition",
                      cell.isPast && "cursor-not-allowed border-transparent bg-transparent text-off",
                      !cell.isPast &&
                        cell.isUnavailable &&
                        "cursor-not-allowed border-busy bg-busy-bg text-busy line-through decoration-[1.5px]",
                      !disabled &&
                        (isStart || isEnd) &&
                        "border-transparent bg-linear-[140deg,var(--gold-500),var(--gold-600)] text-night-900 shadow-gold",
                      !disabled && !isStart && !isEnd && inRange && "border-transparent bg-gold-100 text-bronze",
                      !disabled &&
                        !isStart &&
                        !isEnd &&
                        !inRange &&
                        cell.isWeekend &&
                        "cursor-pointer border-sand-200 bg-sand-100 text-ink hover:border-gold-500",
                      !disabled &&
                        !isStart &&
                        !isEnd &&
                        !inRange &&
                        !cell.isWeekend &&
                        "cursor-pointer border-line bg-surface text-ink hover:border-gold-500",
                    )}
                  >
                    <span>{cell.label}</span>
                    {cell.hijri && (
                      <span className="mt-0.5 text-[9px] font-medium opacity-55">{cell.hijri}</span>
                    )}
                    {/* A dot rather than a colour, so the occasion marker can
                        sit on top of whatever state the cell already has —
                        selected, in-range, weekend or unavailable — instead of
                        competing with it for the background. */}
                    {isSpecial && (
                      <span
                        aria-hidden
                        className="absolute bottom-1 size-1.25 rounded-full bg-gold-600"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* legend */}
      <div className="mt-4 flex flex-wrap gap-3.5 border-t border-line pt-3.5">
        <Legend swatch="border border-line bg-surface" label={t.listing.dayAvailable} />
        <Legend swatch="border border-busy bg-busy-bg" label={t.listing.dayBooked} />
        <Legend
          swatch="border border-sand-200 bg-sand-100"
          label={t.listing.weekendHigher}
        />
        <Legend
          swatch="bg-linear-[140deg,var(--gold-500),var(--gold-600)]"
          label={t.listing.yourSelection}
        />
      </div>

      {/* Suppressed in single-day mode: there is no check-out to ask for, and
          the prompt would sit there permanently after a completed selection. */}
      {!singleDay && value.checkIn && !value.checkOut && (
        <p className="m-0 mt-3 rounded-xl bg-gold-100 px-3 py-2.5 text-[12.5px] font-semibold text-bronze">
          {t.listing.pickCheckOutNow}
        </p>
      )}
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12.5px] text-muted">
      <span className={clsx("size-3.5 rounded-[5px]", swatch)} aria-hidden />
      {label}
    </span>
  );
}

/** Shared helper: the next free night after a date, used to suggest a default. */
export function firstFreeNight(unavailable: Set<ISODate>, from: ISODate = todayISO()): ISODate {
  let cursor = from;
  for (let i = 0; i < 365; i++) {
    if (!unavailable.has(cursor)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return from;
}
