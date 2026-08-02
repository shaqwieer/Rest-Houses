import { ar, type Dictionary } from "./ar";
import { en } from "./en";
import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "./config";

/**
 * Dictionary lookup — the runtime half of the i18n stack.
 *
 * Deliberately free of `next/headers`, React and Prisma so it can be imported
 * from anywhere: server components, client components, server actions, the
 * `scripts/` CLI tools and the test suite alike. The *resolution* of which
 * locale applies lives in ./server.ts (cookie) and ./provider.tsx (context).
 */

export const DICTIONARIES: Record<Locale, Dictionary> = { ar, en };

/**
 * The dictionary for a locale. Anything unrecognised resolves to Arabic rather
 * than throwing — a bad cookie should never blank the page.
 */
export function getDictionary(locale: Locale | string | undefined): Dictionary {
  return DICTIONARIES[normalizeLocale(locale)];
}

export { ar, en, DEFAULT_LOCALE };
export type { Dictionary, Locale };
export * from "./config";
