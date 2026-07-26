/**
 * Display formatting.
 *
 * The design renders every number in Arabic-Indic digits (١٨٠٠ د.إ، حتى ٦٠ ضيف،
 * ٤٫٩ ★). These helpers are DISPLAY-ONLY — never feed their output back into
 * arithmetic, a `value` attribute, or a query string. Form inputs
 * (`<input type="number">`, the phone field) intentionally stay on Latin digits
 * so keyboards, validation and `parseInt` all behave normally.
 */

const AR = "ar-EG"; // Egyptian Arabic locale → Arabic-Indic digits + ٬ grouping

const intFormatter = new Intl.NumberFormat(AR, { maximumFractionDigits: 0 });
const oneDecimalFormatter = new Intl.NumberFormat(AR, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** 1800 → "١٬٨٠٠" */
export function arNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "٠";
  return intFormatter.format(n);
}

/** 4.9 → "٤٫٩"  (always one decimal, as the design's rating chips do) */
export function arRating(n: number | null | undefined): string {
  if (!n) return "٠٫٠";
  return oneDecimalFormatter.format(n);
}

/** 72 → "٧٢٪" */
export function arPercent(n: number): string {
  return `${arNum(n)}٪`;
}

/** Latin digits → Arabic-Indic, leaving everything else untouched.
 *  Used for pre-formatted strings such as "RQ-2419" → "RQ-٢٤١٩". */
const ARABIC_INDIC = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

export function toArabicDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]);
}

/** Price with the dirham unit, e.g. "١٬٨٠٠ د.إ" */
export function arPrice(n: number): string {
  return `${arNum(n)} د.إ`;
}

/**
 * Human "time ago" in Arabic, for review timestamps.
 * Deliberately coarse — the design shows "قبل ٦ أيام" / "قبل شهر".
 */
export function arTimeAgo(date: Date, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return "اليوم";
  if (days === 1) return "أمس";
  if (days < 7) return `قبل ${arNum(days)} أيام`;
  if (days < 14) return "قبل أسبوع";
  if (days < 30) return `قبل ${arNum(Math.floor(days / 7))} أسابيع`;
  if (days < 60) return "قبل شهر";
  if (days < 365) return `قبل ${arNum(Math.floor(days / 30))} أشهر`;
  const years = Math.floor(days / 365);
  return years === 1 ? "قبل سنة" : `قبل ${arNum(years)} سنوات`;
}

/**
 * Strip a phone number down to the digits `wa.me` expects.
 * "+971 50 214 8890" → "971502148890"
 */
export function whatsappDigits(raw: string): string {
  return String(raw ?? "").replace(/[^0-9]/g, "");
}
