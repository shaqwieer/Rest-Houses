/**
 * Locale configuration — the smallest module in the i18n stack, imported by
 * everything else including the middleware (which runs on the edge runtime and
 * must not pull in Prisma, React or the dictionaries).
 *
 * ─── Why there is no `[locale]` route segment ────────────────────────────────
 * The conventional Next.js i18n shape puts every page under `src/app/[locale]/`.
 * This codebase can't take that shape cheaply:
 *
 *   • `revalidatePath("/")`, `revalidatePath("/listings")` and
 *     `revalidatePath(\`/listings/${slug}\`)` are called from four server-action
 *     modules. Under a locale segment every one becomes wrong — it would
 *     revalidate a path that no longer exists — and each needs a per-locale loop.
 *   • `middleware.ts`, `sitemap.ts` and `robots.ts` are all path-literal.
 *   • Every internal `<Link href="/listings">` in the tree would need rewriting.
 *
 * So the locale lives in a cookie instead. The trade-offs, stated plainly:
 *   − the two languages share one URL, so they can't be indexed separately by
 *     search engines and can't be deep-linked ("send me the English page")
 *   + zero route churn, no redirect hop on first visit, and the selected
 *     language survives refresh *and* login because a cookie is sent with every
 *     request including the post-login redirect
 *
 * If per-locale URLs are wanted later, the dictionary layer below is unchanged —
 * only `getLocale()` swaps a cookie read for a route param.
 */

export const LOCALES = ["ar", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * Arabic is the default, as required: a visitor with no cookie and no stored
 * preference gets Arabic, not a browser-negotiated guess.
 */
export const DEFAULT_LOCALE: Locale = "ar";

/** Name of the cookie carrying the visitor's choice. */
export const LOCALE_COOKIE = "locale";

/** One year. Long enough that the choice is effectively permanent. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Anything unrecognised (missing cookie, tampered value) falls back to Arabic. */
export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export type Direction = "rtl" | "ltr";

/** Arabic renders right-to-left; English left-to-right. */
export function getDirection(locale: Locale): Direction {
  return locale === "ar" ? "rtl" : "ltr";
}

/** The BCP-47 tag for `<html lang>`, `Intl` formatters and OpenGraph. */
export function htmlLang(locale: Locale): string {
  return locale === "ar" ? "ar" : "en";
}

/** Locale tag used for OpenGraph `og:locale`. */
export function ogLocale(locale: Locale): string {
  return locale === "ar" ? "ar_AE" : "en_AE";
}

/** Human label for the language switcher — each shown in its own language. */
export const LOCALE_LABELS: Record<Locale, string> = {
  ar: "العربية",
  en: "English",
};

/** The other locale — what the switcher toggles to. */
export function otherLocale(locale: Locale): Locale {
  return locale === "ar" ? "en" : "ar";
}

/* -------------------------------------------------------------------------- */
/* Pluralisation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The grammatical number forms a language distinguishes.
 *
 * English needs two ("1 result" / "2 results"). Arabic needs five — singular,
 * dual, the 3–10 form, the 11+ form and zero — and getting it wrong is the
 * first thing a native reader notices:
 *
 *   ٠ نتائج   ١ نتيجة   ٢ نتيجتان   ٣ نتائج   ١١ نتيجة
 *
 * `Intl.PluralRules` already encodes both sets of rules, so this is a thin
 * wrapper over it rather than a hand-rolled table.
 */
export type PluralForms = {
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

const pluralRules: Record<Locale, Intl.PluralRules> = {
  ar: new Intl.PluralRules("ar"),
  en: new Intl.PluralRules("en"),
};

/**
 * Pick the right form for a count.
 *
 * Falls back down the chain (`zero`→`other`, `two`→`other`, …) so a dictionary
 * entry only has to supply the forms its language actually uses: an English
 * entry gives `one` and `other` and never thinks about the dual.
 */
export function plural(locale: Locale, count: number, forms: PluralForms): string {
  const category = pluralRules[locale].select(count);

  switch (category) {
    case "zero":
      return forms.zero ?? forms.other;
    case "one":
      return forms.one;
    case "two":
      return forms.two ?? forms.other;
    case "few":
      return forms.few ?? forms.other;
    case "many":
      return forms.many ?? forms.other;
    default:
      return forms.other;
  }
}
