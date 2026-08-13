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

/* --------------------------------------------------------------------------
 * Gulf time — the one clock this application tells the time by.
 *
 * The audience, the rest houses, the owners and the operator are all in the
 * UAE. The server may be anywhere. So every *instant* this application shows a
 * human — a step completed at 01:00, an audit entry, a booking's timestamp —
 * is rendered in Asia/Dubai, and "today" flips at Gulf midnight rather than at
 * the server's midnight or at UTC's.
 *
 * A fixed +4 offset rather than an Intl timezone lookup: the UAE has observed
 * UTC+4 with no daylight saving since 1972, so there is no transition to get
 * right, and arithmetic on a constant cannot fail on a Node build shipped
 * without full ICU data — which the Hijri helper below has to guard against.
 *
 * `TZ=Asia/Dubai` is also set on the container (see the Dockerfile) so that
 * anything outside this module — a log line, a database `now()` — agrees. That
 * is belt and braces, deliberately: this module does not depend on it.
 *
 * NOTE the boundary this does NOT cross. Calendar days — `Availability.date`,
 * `checkIn`, `checkOut` — stay plain `YYYY-MM-DD` strings and are never
 * shifted by any of this. A booked night is a calendar fact with no timezone;
 * see the note at the top of this file.
 * -------------------------------------------------------------------------- */

/** The IANA name, for the places that want a real timezone (logs, container). */
export const SITE_TIME_ZONE = "Asia/Dubai";

/** UTC+4, no DST. */
const GULF_OFFSET_MS = 4 * 60 * 60 * 1000;

/** An instant, shifted so its UTC components read as Gulf wall-clock time. */
function toGulf(date: Date): Date {
  return new Date(date.getTime() + GULF_OFFSET_MS);
}

/** The calendar day an instant falls on **in the UAE**. */
export function toGulfISODate(date: Date): ISODate {
  return toGulf(date).toISOString().slice(0, 10);
}

/** Today, as seen in the UAE. */
export function todayISO(now: Date = new Date()): ISODate {
  return toGulfISODate(now);
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

/**
 * The calendar days a booking takes off the market — the ONE place that answers
 * that question for both kinds of stay.
 *
 * ─── Why this exists rather than `nightsInRange` everywhere ──────────────────
 * A day-use booking (حجز بدون مبيت) stores `checkOut === checkIn` and
 * `nights = 0`, because that is the truth: the guest arrives and leaves the same
 * day. `nightsInRange` correctly returns `[]` for that range — there are no
 * nights — and every caller that blocks, re-checks or releases a calendar would
 * therefore block *nothing*. The rest house would stay bookable by someone else
 * on a day it is already taken, and the clash check that guards a confirmation
 * would wave the second booking straight through.
 *
 * So availability goes through here and pricing does not: `quote()` prices a
 * day-use stay from the day rate and has its own branch. This function answers
 * exactly one question — which days are occupied — and every call site that
 * writes, reads or deletes an `Availability` row uses it.
 *
 * ─── The over-block, stated plainly ──────────────────────────────────────────
 * A day-use booking blocks its whole day, which also stops an overnight guest
 * *checking out* that morning — something that would in reality be fine, since
 * one leaves at noon and the other arrives in the afternoon. Modelling that
 * needs a second availability semantic (half-days, or a distinction between
 * "arriving" and "departing" on the same date) threaded through the calendar,
 * the clash check and the owner's blocking tool. That is a much larger change
 * than "let people book a day", and the error here is in the safe direction: an
 * occasional lost booking rather than two guests turning up at once.
 */
export function occupiedDays(
  checkIn: ISODate,
  checkOut: ISODate,
  dayUse = false,
): ISODate[] {
  if (dayUse) return [checkIn];
  return nightsInRange(checkIn, checkOut);
}

/* --------------------------------------------------------------------------
 * Calendar months.
 *
 * A *calendar* month — 1 August to 31 August — not thirty rolling days from
 * today. The distinction is the whole point: an operator comparing August with
 * September is comparing two months as a calendar shows them, and a rolling
 * window that starts on the 12th answers a question nobody asked. It also gets
 * the denominator wrong, because August has 31 nights to sell and September 30.
 *
 * `to` is EXCLUSIVE — the first day of the following month — so it drops
 * straight into the `{ gte: from, lt: to }` shape every date query in this
 * codebase already uses, with no off-by-one on the last day of the month.
 * -------------------------------------------------------------------------- */

export type MonthRange = {
  /** First day of the month, "YYYY-MM-01". */
  from: ISODate;
  /** First day of the NEXT month. Exclusive. */
  to: ISODate;
  /** Days in the month: 28, 29, 30 or 31. The occupancy denominator. */
  days: number;
  year: number;
  /** 0-indexed, ready for `monthNames` / `arMonthLabel`. */
  month: number;
};

/**
 * The calendar month `iso` falls in, or one `offset` months away from it.
 *
 * Built with `Date.UTC(y, m + offset, 1)`, which normalises an out-of-range
 * month by itself: December + 1 is January of the next year, with no wrapping
 * arithmetic here to get wrong.
 */
export function monthRange(iso: ISODate, offset = 0): MonthRange {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7)) - 1; // 0-indexed

  const start = new Date(Date.UTC(year, month + offset, 1));
  const end = new Date(Date.UTC(year, month + offset + 1, 1));

  return {
    from: toISODate(start),
    to: toISODate(end),
    days: Math.round((end.getTime() - start.getTime()) / 86_400_000),
    year: start.getUTCFullYear(),
    month: start.getUTCMonth(),
  };
}

/** 0 = Sunday … 6 = Saturday, for the given calendar day. */
export function dayOfWeek(iso: ISODate): number {
  return parseISODate(iso).getUTCDay();
}

/* --------------------------------------------------------------------------
 * Which days carry the weekend rate — a per-listing decision, not a national
 * constant.
 *
 * Nearly every rest house fills on Friday and Saturday and prices those two
 * nights above the rest of the week. Some are just as busy on Sunday and want
 * the weekend rate on a third night — Sharjah's four-day working week is the
 * clearest case, but any owner may choose it. Owners asked for the choice
 * explicitly, and it is a commercial term of the individual venue — there is no
 * single answer to hard-code and no platform-wide setting to hang it on.
 *
 *   "short" — Friday, Saturday.            The default.
 *   "long"  — Friday, Saturday, Sunday.    A third weekend night.
 *
 * SUNDAY is the only day the two modes disagree about. Worth knowing before
 * writing anything meant to tell them apart: a case built around Friday now
 * proves nothing, because both modes charge it.
 *
 * ─── Nights, not days ────────────────────────────────────────────────────────
 * Pricing walks *nights*, and a night is named by the day it begins on (see
 * `nightsInRange`). So "Friday is a weekend day" means the night that STARTS
 * on Friday carries the weekend rate. A guest arriving Friday and leaving
 * Monday on a short-weekend listing pays the weekend rate for the Friday and
 * Saturday nights and the weekday rate for the Sunday one.
 *
 * ─── Stored as a string, normalised on read ──────────────────────────────────
 * `Listing.weekendMode` is a plain `String` column, matching how every other id
 * in this schema is stored (see the portability note in prisma/schema.prisma).
 * Nothing at the database level stops a stray value getting in, so every read
 * goes through `toWeekendMode`, which falls back to "short" rather than
 * throwing mid-quote or — far worse — returning `undefined` days and pricing a
 * whole stay at the weekday rate.
 * -------------------------------------------------------------------------- */

export type WeekendMode = "short" | "long";

/** For the `<select>` in the listing editor and the server-side enum. */
export const WEEKEND_MODES = ["short", "long"] as const satisfies readonly WeekendMode[];

/**
 * What a listing gets when nobody has chosen: Friday and Saturday, the two
 * nights nearly every rest house fills.
 *
 * Also what every listing that predates this feature resolves to, and what any
 * unrecognised stored value falls back to.
 */
export const DEFAULT_WEEKEND_MODE: WeekendMode = "short";

/** 0 = Sunday … 6 = Saturday, matching `dayOfWeek`. */
const WEEKEND_DAYS: Record<WeekendMode, readonly number[]> = {
  short: [5, 6], // Friday, Saturday
  long: [5, 6, 0], // Friday, Saturday, Sunday
};

export function isWeekendMode(value: unknown): value is WeekendMode {
  return value === "short" || value === "long";
}

/** Any stored value → a mode that is safe to price with. */
export function toWeekendMode(value: unknown): WeekendMode {
  return isWeekendMode(value) ? value : DEFAULT_WEEKEND_MODE;
}

/** The weekday numbers this mode charges the weekend rate on. */
export function weekendDays(mode: WeekendMode): readonly number[] {
  return WEEKEND_DAYS[toWeekendMode(mode)];
}

/**
 * Does this day carry the weekend rate for a listing on `mode`?
 *
 * `mode` is deliberately REQUIRED rather than defaulted. Every caller is either
 * pricing a stay, shading a calendar cell or counting weekend demand, and each
 * of those has a listing in hand; a default would let a call site quietly bill
 * a long-weekend listing's Sunday at the weekday rate, which is precisely the
 * bug this whole mechanism exists to prevent. The compiler asking the question
 * at each of the five call sites is the point.
 */
export function isWeekend(iso: ISODate, mode: WeekendMode): boolean {
  return weekendDays(mode).includes(dayOfWeek(iso));
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

/**
 * An instant, as the calendar day it happened on **in the UAE**.
 *
 * Distinct from `formatDate` above, and the distinction is load-bearing.
 * `formatDate` renders a stored `DateTime` that stands for a *day* — a
 * membership expiry — from its UTC components, so "expires on the 30th" reads
 * as the 30th everywhere. This one renders a *moment* — a step completed, an
 * invite issued — and a moment at 01:00 Dubai time is 21:00 UTC on the day
 * before, so reading it as UTC would date it a day early to the very people
 * who performed it.
 */
export function formatInstant(
  date: Date | null | undefined,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (!date) return "—";
  return arFullDate(toGulfISODate(date), locale);
}

/** A timestamp with the time of day, for the audit log. Gulf time throughout. */
export function formatDateTime(
  date: Date | null | undefined,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (!date) return "—";

  // Both halves come from the same shifted instant. Reading the hour in Gulf
  // time while dating the row in UTC would put a 01:00 action on the previous
  // day — the audit log's whole job is to say when something happened.
  const gulf = toGulf(date);
  const hh = String(gulf.getUTCHours()).padStart(2, "0");
  const mm = String(gulf.getUTCMinutes()).padStart(2, "0");

  // Both halves go through the same digit conversion. Running the hour through
  // `arNum` while leaving the minutes alone produced a mixed-script, unpadded
  // "٩:05" in the Arabic audit log; `toArabicDigits` maps the already-padded
  // string so "09:05" becomes "٠٩:٠٥".
  const clock = `${hh}:${mm}`;
  const time = locale === "ar" ? toArabicDigits(clock) : clock;

  return `${arFullDate(toGulfISODate(date), locale)} · ${time}`;
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
  /**
   * The listing's weekend, so the shaded cells are the ones actually charged at
   * the weekend rate. Both call sites pass it; a Sharjah calendar that left
   * Friday unshaded while the quote charged it the weekend price would be the
   * page arguing with itself.
   */
  weekendMode: WeekendMode = DEFAULT_WEEKEND_MODE,
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
      isWeekend: isWeekend(iso, weekendMode),
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
