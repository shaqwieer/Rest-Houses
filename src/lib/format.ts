import { DEFAULT_LOCALE, type Locale } from "./i18n/config";

/**
 * Display formatting.
 *
 * The Arabic design renders every number in Arabic-Indic digits (١٨٠٠ د.إ، حتى
 * ٦٠ ضيف، ٤٫٩ ★); the English site renders the same values in Latin digits with
 * comma grouping (1,800 AED). Both live here.
 *
 * These helpers are DISPLAY-ONLY — never feed their output back into arithmetic,
 * a `value` attribute, or a query string. Form inputs (`<input type="number">`,
 * the phone field) intentionally stay on Latin digits so keyboards, validation
 * and `parseInt` all behave normally.
 *
 * ─── Why every function takes an optional trailing `locale` ──────────────────
 * Defaulting to Arabic keeps every pre-existing call site (`arNum(1800)`)
 * correct and unchanged, so adding English was not a repo-wide rename with a
 * chance to silently mistranslate a screen. Callers that know their locale pass
 * it; the ones that are Arabic-only by construction simply don't.
 */

const LOCALE_TAG: Record<Locale, string> = {
  // Egyptian Arabic → Arabic-Indic digits + ٬ grouping
  ar: "ar-EG",
  en: "en-AE",
};

/** Currency unit, written the way each language writes it. */
const CURRENCY: Record<Locale, string> = {
  ar: "د.إ",
  en: "AED",
};

/** Percent sign — Arabic uses the Arabic percent sign ٪ (U+066A). */
const PERCENT: Record<Locale, string> = {
  ar: "٪",
  en: "%",
};

// Intl.NumberFormat construction is not free, and these are called once per
// price on a grid of cards — build each formatter once and reuse it.
const intFormatters: Record<Locale, Intl.NumberFormat> = {
  ar: new Intl.NumberFormat(LOCALE_TAG.ar, { maximumFractionDigits: 0 }),
  en: new Intl.NumberFormat(LOCALE_TAG.en, { maximumFractionDigits: 0 }),
};

const oneDecimalFormatters: Record<Locale, Intl.NumberFormat> = {
  ar: new Intl.NumberFormat(LOCALE_TAG.ar, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }),
  en: new Intl.NumberFormat(LOCALE_TAG.en, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }),
};

/** 1800 → "١٬٨٠٠" (ar) / "1,800" (en) */
export function arNum(n: number | null | undefined, locale: Locale = DEFAULT_LOCALE): string {
  if (n === null || n === undefined || Number.isNaN(n)) {
    return locale === "ar" ? "٠" : "0";
  }
  return intFormatters[locale].format(n);
}

/**
 * A calendar year, formatted **without** thousands grouping.
 *
 * `arNum(2026)` renders "٢٬٠٢٦" / "2,026" — a year is not a quantity and must
 * not be grouped. This was rendering as "٢٨ يوليو ٢٬٠٢٦" on every full date on
 * the site before it was caught by tests/i18n.test.ts.
 */
const yearFormatters: Record<Locale, Intl.NumberFormat> = {
  ar: new Intl.NumberFormat(LOCALE_TAG.ar, { useGrouping: false, maximumFractionDigits: 0 }),
  en: new Intl.NumberFormat(LOCALE_TAG.en, { useGrouping: false, maximumFractionDigits: 0 }),
};

export function arYear(year: number, locale: Locale = DEFAULT_LOCALE): string {
  return yearFormatters[locale].format(year);
}

/** 4.9 → "٤٫٩" / "4.9"  (always one decimal, as the design's rating chips do) */
export function arRating(n: number | null | undefined, locale: Locale = DEFAULT_LOCALE): string {
  if (!n) return locale === "ar" ? "٠٫٠" : "0.0";
  return oneDecimalFormatters[locale].format(n);
}

/** 72 → "٧٢٪" / "72%" */
export function arPercent(n: number, locale: Locale = DEFAULT_LOCALE): string {
  return `${arNum(n, locale)}${PERCENT[locale]}`;
}

/** Just the percent sign for the active language. */
export function percentSign(locale: Locale = DEFAULT_LOCALE): string {
  return PERCENT[locale];
}

/** Just the currency unit for the active language. */
export function currencyUnit(locale: Locale = DEFAULT_LOCALE): string {
  return CURRENCY[locale];
}

/** Latin digits → Arabic-Indic, leaving everything else untouched.
 *  Used for pre-formatted strings such as "RQ-2419" → "RQ-٢٤١٩". */
const ARABIC_INDIC = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

export function toArabicDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]);
}

/**
 * A reference such as "RQ-2419", digit-shaped for the active language.
 *
 * English keeps the Latin digits it was generated with, so the string a customer
 * reads back to an owner over the phone matches the one stored in the database.
 */
export function formatReference(reference: string, locale: Locale = DEFAULT_LOCALE): string {
  return locale === "ar" ? toArabicDigits(reference) : reference;
}

/** Price with the currency unit, e.g. "١٬٨٠٠ د.إ" / "1,800 AED" */
export function arPrice(n: number, locale: Locale = DEFAULT_LOCALE): string {
  return `${arNum(n, locale)} ${CURRENCY[locale]}`;
}

/**
 * Human "time ago", for review timestamps.
 * Deliberately coarse — the design shows "قبل ٦ أيام" / "6 days ago".
 */
export function arTimeAgo(
  date: Date,
  now: Date = new Date(),
  locale: Locale = DEFAULT_LOCALE,
): string {
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);

  if (locale === "en") {
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    if (days < 14) return "A week ago";
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    if (days < 60) return "A month ago";
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    const y = Math.floor(days / 365);
    return y === 1 ? "A year ago" : `${y} years ago`;
  }

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
 * Arabic-Indic (٠١٢…) and Eastern Arabic-Indic (۰۱۲…) digits → ASCII.
 *
 * Applied to anything numeric that can arrive from a user's keyboard before it
 * is parsed or stored. Both ranges are included because Arabic and Persian
 * keyboard layouts emit different code points for the same digits.
 */
export function normalizeDigits(input: string): string {
  return String(input ?? "").replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/**
 * Strip a phone number down to the digits `wa.me` expects.
 * "+971 50 214 8890" → "971502148890"
 *
 * Arabic-Indic digits are normalised to ASCII first: an owner who types their
 * number on an Arabic keyboard would otherwise have every digit stripped by the
 * `[^0-9]` filter, producing a `wa.me/` link with no number in it at all.
 */
export function whatsappDigits(raw: string): string {
  return normalizeDigits(String(raw ?? "")).replace(/[^0-9]/g, "");
}
