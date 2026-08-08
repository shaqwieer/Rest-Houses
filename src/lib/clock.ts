import { DEFAULT_LOCALE, type Locale } from "./i18n/config";
import { toArabicDigits } from "./format";

/**
 * The hour of the day a guest arrives or leaves, as a number.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 * Check-in, check-out and the day-use leave-by hour were free text, with an
 * English sibling column beside each one. Owners were asked to type an hour
 * twice, in two languages, in a box that accepted anything up to 40 characters.
 * They typed "٤ عصرًا", "بعد العصر", "4pm", "4:00", and — most often — nothing
 * at all in the English box. The catalogue ended up advertising arrival times
 * in mixed scripts and mixed formats, some of which are not times.
 *
 * An hour is not prose. It is one of twenty-four values, the same twenty-four
 * in every language, and the difference between "٤ عصرًا" and "4 PM" is a
 * rendering decision the platform can make correctly every time. So the owner
 * picks from a list, one number is stored, and both languages are generated
 * here. That deletes the English boxes, the 40-character free-text problem and
 * the two-columns-per-time schema in one move.
 *
 * ─── Prisma-free, deliberately ───────────────────────────────────────────────
 * Same rule as src/lib/policies.ts: these are pure values a test — or a client
 * component rendering a listing card — must be able to import without dragging
 * a database client into the bundle.
 */

/** Midnight, as stored. Named because `0` reads as "unset" at a glance. */
export const MIDNIGHT = 0;

/** Noon, as stored. */
export const NOON = 12;

/**
 * The platform's own arrival and departure hours, used when neither the listing
 * nor the settings row has said anything at all. These match the Arabic
 * defaults the settings row has always carried ("٤ عصرًا" / "١٢ ظهرًا").
 */
export const DEFAULT_CHECK_IN_HOUR = 16;
export const DEFAULT_CHECK_OUT_HOUR = NOON;

/**
 * The options, in the order they are offered.
 *
 * NOT `0…23`. The list runs 1 AM through 11 PM and ends at midnight, because
 * that is how a person reads a day: midnight is the far end of tonight, not the
 * start of this morning. A natural numeric sort would open the menu on
 * "١٢:٠٠ منتصف الليل", which is the least likely answer of the twenty-four and
 * the one an owner is most likely to leave selected by accident.
 *
 * The *stored* range is still a plain 0–23 — see `isStayHour`. Display order
 * and valid range are separate things and must not be collapsed, or midnight
 * becomes unstorable.
 */
export const STAY_HOURS: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, MIDNIGHT,
];

/** A whole hour of the day: an integer 0–23. Midnight (0) is valid. */
export function isStayHour(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23;
}

/**
 * Anything a form or an old row might hold, narrowed to an hour or null.
 *
 * null means "not set", which the callers give their own meaning to: on the
 * arrival and departure hours it means "fall back"; on the day-use leave-by
 * hour it means "day bookings are not offered". Returning null rather than a
 * number is what keeps those two apart — see `resolveDayUseCheckOut` in
 * src/lib/policies.ts.
 */
export function toStayHour(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return isStayHour(n) ? n : null;
}

/** Arabic-Indic for Arabic, Latin for English — matching every other number. */
function digits(n: number, locale: Locale): string {
  const latin = String(n);
  return locale === "ar" ? toArabicDigits(latin) : latin;
}

/**
 * One hour, written the way each language writes it.
 *
 *   16 → "4:00 PM"          / "٤:٠٠ مساءً"
 *   12 → "12:00 noon"       / "١٢:٠٠ ظهرًا"
 *    0 → "12:00 Midnight"   / "١٢:٠٠ منتصف الليل"
 *
 * Noon and midnight are spelled out rather than left as "12:00 PM" / "12:00 AM"
 * because those two are the pair people actually misread, and a guest who
 * arrives twelve hours late has had their booking ruined by a formatting
 * choice. Every other hour takes the ordinary 12-hour form.
 *
 * Hand-rolled rather than `Intl.DateTimeFormat`: there is no instant here to
 * format. Building a throwaway `Date` to print an hour would drag a timezone
 * into a value that has none — the same mistake the calendar avoids by storing
 * "YYYY-MM-DD" strings (see src/lib/dates.ts) — and `Intl` renders Arabic as
 * "٤:٠٠ م", which is not what the design or the owners asked for.
 */
export function formatHour(hour: number, locale: Locale = DEFAULT_LOCALE): string {
  if (!isStayHour(hour)) return "";

  const minutes = locale === "ar" ? "٠٠" : "00";

  if (hour === MIDNIGHT) {
    return locale === "ar"
      ? `${digits(12, locale)}:${minutes} منتصف الليل`
      : `12:${minutes} Midnight`;
  }
  if (hour === NOON) {
    return locale === "ar" ? `${digits(12, locale)}:${minutes} ظهرًا` : `12:${minutes} noon`;
  }

  const isMorning = hour < NOON;
  const twelveHour = isMorning ? hour : hour - NOON;

  return locale === "ar"
    ? `${digits(twelveHour, locale)}:${minutes} ${isMorning ? "صباحًا" : "مساءً"}`
    : `${twelveHour}:${minutes} ${isMorning ? "AM" : "PM"}`;
}

/**
 * What to write for one stay time, given the hour that was just picked.
 *
 * Picking an hour retires the free text that used to answer for that field:
 * once somebody has chosen 4 PM from a menu, "بعد العصر" sitting in the column
 * beside it is not a second opinion, it is a stale note that the fallback would
 * keep reading the day the hour is ever cleared. Emptying it is how the legacy
 * tier drains — row by row, as owners touch their listings — until the columns
 * can be dropped outright.
 *
 * Leaving the hour unset leaves the text exactly as it was. That is the case
 * where the text is still the only answer this rest house has.
 */
export function stayHourWrite(
  hour: number | null,
  legacy: { arabic: string; english: string | null },
): { hour: number | null; arabic: string; english: string | null } {
  if (!isStayHour(hour)) return { hour: null, arabic: legacy.arabic, english: legacy.english };
  return { hour, arabic: "", english: null };
}

/**
 * The whole option list, ready for a `<select>`, in the caller's language.
 *
 * Returned as `{value, label}` with `value` a *string*, because that is what a
 * `<select>` deals in and converting at the boundary is the caller's job — the
 * empty string is the "not set" option and must stay distinguishable from "0".
 */
export function stayHourOptions(locale: Locale = DEFAULT_LOCALE) {
  return STAY_HOURS.map((hour) => ({ value: String(hour), label: formatHour(hour, locale) }));
}
