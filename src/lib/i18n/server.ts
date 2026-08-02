import { cookies } from "next/headers";
import { cache } from "react";
import { getDictionary } from "./index";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  getDirection,
  normalizeLocale,
  type Direction,
  type Locale,
} from "./config";
import type { Dictionary } from "./ar";

/**
 * Server-side locale resolution.
 *
 * ─── The rendering trade-off, stated up front ────────────────────────────────
 * Reading a cookie opts the calling render into dynamic rendering. The home page
 * and the whole admin tree are already `force-dynamic`, so they lose nothing.
 * Listing detail pages, which previously could be statically generated, now
 * render per request.
 *
 * That cost is accepted deliberately. The alternative — rendering a static
 * Arabic page and switching to English on the client — produces a visible flash
 * of the wrong language *and* the wrong text direction on every load for English
 * visitors, and would leave `<html lang>`/`<html dir>` wrong in the HTML that
 * search engines and screen readers actually read. Correct direction on first
 * paint is worth more here than a cached HTML document, especially for a
 * catalogue whose prices and availability were never safe to cache for long
 * anyway.
 *
 * `cache()` de-duplicates the cookie read across one render pass, so a page
 * whose layout, header, body and footer each ask for the locale reads it once.
 */

export const getLocale = cache(async (): Promise<Locale> => {
  try {
    const store = await cookies();
    return normalizeLocale(store.get(LOCALE_COOKIE)?.value);
  } catch {
    // `cookies()` throws outside a request scope (e.g. during a static prerender
    // of an error page). Arabic is the documented default, so use it.
    return DEFAULT_LOCALE;
  }
});

/** The dictionary for the current request. */
export const getT = cache(async (): Promise<Dictionary> => {
  return getDictionary(await getLocale());
});

/** Text direction for the current request — drives `<html dir>`. */
export async function getDir(): Promise<Direction> {
  return getDirection(await getLocale());
}

/**
 * Everything a server component usually needs at once.
 *
 * Returned together because almost every caller wants at least two of the three,
 * and three separate awaits of three separately-cached functions is noise.
 */
export async function getI18n(): Promise<{
  locale: Locale;
  t: Dictionary;
  dir: Direction;
}> {
  const locale = await getLocale();
  return { locale, t: getDictionary(locale), dir: getDirection(locale) };
}
