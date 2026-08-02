"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  normalizeLocale,
} from "@/lib/i18n/config";

/**
 * Switch the interface language.
 *
 * Writes an `httpOnly: false` cookie: the value is a public UI preference, not a
 * credential, and leaving it readable lets a future client-side enhancement pick
 * the language up without a round-trip. It is `sameSite: "lax"` so it survives
 * ordinary navigation, and given a one-year lifetime so the choice is effectively
 * permanent.
 *
 * ─── Why a cookie rather than localStorage ───────────────────────────────────
 * The server renders `<html lang>`/`<html dir>` and every translated string, so
 * it has to know the language *before* the response is produced. localStorage is
 * only readable after the JavaScript runs, which means the first paint would be
 * in the wrong language and direction. A cookie is sent with the request — and,
 * because it is sent with *every* request, the choice survives a refresh and a
 * login redirect without any extra work.
 *
 * `revalidatePath("/", "layout")` drops the cached render of the whole tree,
 * which is what makes the already-visited pages come back in the new language
 * rather than from the router cache in the old one.
 */
export async function setLocaleAction(next: string): Promise<{ ok: true }> {
  const locale = normalizeLocale(next);

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });

  revalidatePath("/", "layout");

  return { ok: true };
}
