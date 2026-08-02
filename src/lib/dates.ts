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

import { monthNames } from "./constants";
import { arNum, arYear, toArabicDigits } from "./format";
import { DEFAULT_LOCALE, type Locale } from "./i18n/config";

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

/**
 * ─── Date display ────────────────────────────────────────────────────────────
 * Both languages format a calendar day as "<day> <month>" — Arabic reads it
 * right-to-left with Arabic-Indic digits ("٢٨ يوليو"), English left-to-right
 * with Latin ones ("28 July"). The word order is identical, so one template
 * serves both and only the digits and month name change.
 *
 * Every one of these takes an optional trailing `locale` defaulting to Arabic,
 * so the pre-existing `arDayMonth(iso)` call sites are unchanged in behaviour.
 * The `ar` prefix on the names is now a slight misnomer, kept because renaming
 * them across the tree would have been churn with no behavioural payoff.
 */

/** "٢٨ يوليو" / "28 July" */
export function arDayMonth(iso: ISODate, locale: Locale = DEFAULT_LOCALE): string {
  const d = parseISODate(iso);
  return `${arNum(d.getUTCDate(), locale)} ${monthNames(locale)[d.getUTCMonth()]}`;
}

/** "٢٨ يوليو ٢٠٢٦" / "28 July 2026" */
export function arFullDate(iso: ISODate, locale: Locale = DEFAULT_LOCALE): string {
  const d = parseISODate(iso);
  // The year goes through `arYear`, not `arNum`: a year must not be
  // thousands-grouped ("28 July 2,026").
  return `${arNum(d.getUTCDate(), locale)} ${monthNames(locale)[d.getUTCMonth()]} ${arYear(
    d.getUTCFullYear(),
    locale,
  )}`;
}

/** "يوليو ٢٠٢٦" / "July 2026" — calendar header. `month` is 0-indexed. */
export function arMonthLabel(
  year: number,
  month: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return `${monthNames(locale)[month]} ${arYear(year, locale)}`;
}

/**
 * A stored `DateTime` (membership expiry, audit timestamp) as a calendar day.
 *
 * Formatted from the date's **UTC** components, matching how every other date
 * in this app is handled: a membership that expires "on the 30th" must read as
 * the 30th to everyone, not the 29th to a viewer west of UTC.
 */
export function formatDate(
  date: Date | null | undefined,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (!date) return "—";
  return arFullDate(toISODate(date), locale);
}

/** A timestamp with the time of day, for the audit log. */
export function formatDateTime(
  date: Date | null | undefined,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (!date) return "—";
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");

  // Both halves go through the same digit conversion. Running the hour through
  // `arNum` while leaving the minutes alone produced a mixed-script, unpadded
  // "٩:05" in the Arabic audit log; `toArabicDigits` maps the already-padded
  // string so "09:05" becomes "٠٩:٠٥".
  const clock = `${hh}:${mm}`;
  const time = locale === "ar" ? toArabicDigits(clock) : clock;

  return `${arFullDate(toISODate(date), locale)} · ${time}`;
}

/**
 * Hijri day number for the small secondary label in each calendar cell.
 *
 * Arabic only: the Umm al-Qura date is a genuine convenience for a Gulf
 * audience reading Arabic, and noise beside an English calendar.
 *
 * Wrapped in try/catch: the Umm al-Qura calendar needs full ICU data, which a
 * minimal Node build may not ship. Missing data hides the label instead of
 * throwing during render.
 */
export function hijriDay(iso: ISODate, locale: Locale = DEFAULT_LOCALE): string {
  if (locale === "en") return "";
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
  locale: Locale = DEFAULT_LOCALE,
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
      label: arNum(day, locale),
      hijri: hijriDay(iso, locale),
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
