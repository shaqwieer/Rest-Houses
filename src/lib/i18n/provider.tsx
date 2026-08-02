"use client";

import { createContext, useContext, useMemo } from "react";
import { getDictionary } from "./index";
import { DEFAULT_LOCALE, getDirection, type Direction, type Locale } from "./config";
import type { Dictionary } from "./ar";

/**
 * Locale context for client components.
 *
 * ─── Why the context carries a locale *string*, not a dictionary ─────────────
 * The dictionaries contain **functions** (every interpolated string is one).
 * Functions cannot cross the server/client boundary — React would throw when
 * serialising them into the RSC payload — so a server component cannot simply
 * pass `t` down as a prop to a client component.
 *
 * Instead the provider carries the two-character locale, and `useT()` resolves
 * the dictionary from a plain static import on the client. The cost is that both
 * dictionaries are bundled into the client chunk rather than only the active
 * one. For two languages of a few hundred short strings that is a few tens of
 * kilobytes before compression — cheaper than the alternatives (a fetch per
 * locale switch, or hoisting every translated string into server components and
 * threading dozens of extra props through the tree), and it makes switching
 * language instant with no network round-trip.
 */

type LocaleContextValue = {
  locale: Locale;
  t: Dictionary;
  dir: Direction;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const value = useMemo<LocaleContextValue>(
    () => ({ locale, t: getDictionary(locale), dir: getDirection(locale) }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * Full locale state for a client component.
 *
 * Falls back to Arabic rather than throwing when no provider is above it. A
 * missing provider is a developer error, but blanking a page in production over
 * it is worse than rendering the default language.
 */
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (ctx) return ctx;
  return {
    locale: DEFAULT_LOCALE,
    t: getDictionary(DEFAULT_LOCALE),
    dir: getDirection(DEFAULT_LOCALE),
  };
}

/** The common case: just the dictionary. */
export function useT(): Dictionary {
  return useLocale().t;
}
