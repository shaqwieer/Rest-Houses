/**
 * Calendar-day helpers.
 *
 * The whole app treats a "day" as a `YYYY-MM-DD` string (an `ISODate` below),
 * never a `Date`/timestamp. Reason: a booked day is a calendar fact, not an
 * instant. `new Date(2026, 6, 25)` is *local* midnight — serialise it and a
 * visitor in a negative-offset timezone sees 2026-07-24, so a day the owner
 * blocked silently reads as available. Strings have no offset to get wrong.
 *
 * `Date` is used only for arithmetic (adding days, finding a weekday), always
 * via `parseISODate` which constructs UTC midnight so the arithmetic is stable.
 */

import { MONTHS_AR } from "./constants";
import { arNum } from "./format";

/** A calendar day in `YYYY-MM-DD` form. */
export type ISODate = string;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(v: unknown): v is ISODate {
  if (typeof v !== "string" || !ISO_RE.test(v)) return false;
  // Reject impossible days such as 2026-02-31 that pass the regex.
  const d = parseISODate(v);
  return toISODate(d) === v;
}

/** `YYYY-MM-DD` → a Date at UTC midnight of that day. */
export function parseISODate(iso: ISODate): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** A Date → the `YYYY-MM-DD` of its **UTC** day. Pair only with UTC-built Dates. */
export function toISODate(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

/** Today, as seen in the UAE (UTC+4, no DST). The site's audience is local, so
 *  "today" should flip at Gulf midnight rather than the server's midnight. */
export function todayISO(now: Date = new Date()): ISODate {
  const gulf = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  return gulf.toISOString().slice(0, 10);
}

export function addDays(iso: ISODate, days: number): ISODate {
  const d = parseISODate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

/** Nights between check-in and check-out (check-out is exclusive). */
export function nightsBetween(checkIn: ISODate, checkOut: ISODate): number {
  const diff = parseISODate(checkOut).getTime() - parseISODate(checkIn).getTime();
  return Math.max(0, Math.round(diff / 86_400_000));
}

/** Every night actually occupied by a stay: check-in .. check-out-1.
 *  Check-out day is free — the next guest can arrive that afternoon. */
export function nightsInRange(checkIn: ISODate, checkOut: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const total = nightsBetween(checkIn, checkOut);
  for (let i = 0; i < total; i++) out.push(addDays(checkIn, i));
  return out;
}

/** 0 = Sunday … 6 = Saturday, for the given calendar day. */
export function dayOfWeek(iso: ISODate): number {
  return parseISODate(iso).getUTCDay();
}

/** UAE weekend: Friday (5) and Saturday (6) carry the weekend rate. */
export function isWeekend(iso: ISODate): boolean {
  const dow = dayOfWeek(iso);
  return dow === 5 || dow === 6;
}

/** "٢٨ يوليو" */
export function arDayMonth(iso: ISODate): string {
  const d = parseISODate(iso);
  return `${arNum(d.getUTCDate())} ${MONTHS_AR[d.getUTCMonth()]}`;
}

/** "٢٨ يوليو ٢٠٢٦" */
export function arFullDate(iso: ISODate): string {
  const d = parseISODate(iso);
  return `${arNum(d.getUTCDate())} ${MONTHS_AR[d.getUTCMonth()]} ${arNum(d.getUTCFullYear())}`;
}

/** "يوليو ٢٠٢٦" — calendar header. `month` is 0-indexed. */
export function arMonthLabel(year: number, month: number): string {
  return `${MONTHS_AR[month]} ${arNum(year)}`;
}

/**
 * Hijri day number for the small secondary label in each calendar cell.
 * Wrapped in try/catch: the Umm al-Qura calendar needs full ICU data, which a
 * minimal Node build may not ship. Missing data hides the label instead of
 * throwing during render.
 */
export function hijriDay(iso: ISODate): string {
  try {
    return new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", {
      day: "numeric",
      timeZone: "UTC",
    }).format(parseISODate(iso));
  } catch {
    return "";
  }
}

/* -------------------------------------------------------------------------- */
/* Month grid                                                                 */
/* -------------------------------------------------------------------------- */

export type CalendarCell =
  | { kind: "blank"; key: string }
  | {
      kind: "day";
      key: string;
      iso: ISODate;
      dayNumber: number;
      label: string; // Arabic-Indic day number
      hijri: string;
      isPast: boolean;
      isWeekend: boolean;
      isUnavailable: boolean; // blocked or booked by the owner
    };

/**
 * Build a Sunday-first month grid. Leading blanks pad the first week so the
 * columns line up with DOW_AR (index 0 = الأحد).
 *
 * @param unavailable set of ISO dates the owner has blocked/booked
 */
export function buildMonthGrid(
  year: number,
  month: number,
  unavailable: ReadonlySet<ISODate>,
  today: ISODate = todayISO(),
): CalendarCell[] {
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const cells: CalendarCell[] = [];
  for (let i = 0; i < firstDow; i++) cells.push({ kind: "blank", key: `b${i}` });

  for (let day = 1; day <= daysInMonth; day++) {
    const iso = toISODate(new Date(Date.UTC(year, month, day)));
    const isPast = iso < today; // lexicographic compare is correct for YYYY-MM-DD
    cells.push({
      kind: "day",
      key: iso,
      iso,
      dayNumber: day,
      label: arNum(day),
      hijri: hijriDay(iso),
      isPast,
      isWeekend: isWeekend(iso),
      // A past date is already unselectable; don't also paint it "booked".
      isUnavailable: !isPast && unavailable.has(iso),
    });
  }

  return cells;
}

/** Month navigation that can't run off the end of a year. */
export function shiftMonth(year: number, month: number, delta: number) {
  const d = new Date(Date.UTC(year, month + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}
