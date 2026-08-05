import { normalizeDigits } from "./format";

/**
 * Phone numbers — one canonical shape for the whole application.
 *
 * ─── The stored form ─────────────────────────────────────────────────────────
 * Digits only, country code first, **no leading "+"**:
 *
 *     971503322119
 *
 * That is the shape `wa.me` wants, the shape an owner signs in with (see
 * `User.username` in prisma/schema.prisma), and now the shape every phone
 * column holds. Picking one and normalising at every entry point is what makes
 * those three the same string rather than three near-misses — "+971 50 332
 * 2119" and "0503322119" are the same line, and until this module existed they
 * were two different rows, two different rate-limit budgets, and a login that
 * worked only if you typed your number the way you typed it at registration.
 *
 * ─── Why this is not just a regex ────────────────────────────────────────────
 * The shapes people actually type for an Emirati mobile are all legitimate:
 *
 *   "+971 50 332 2119" → 971503322119   (already international)
 *   "00971503322119"   → 971503322119   (00 international prefix)
 *   "0503322119"       → 971503322119   (national trunk 0 → country code)
 *   "503322119"        → 971503322119   (bare national number)
 *   "٠٥٠٣٣٢٢١١٩"        → 971503322119   (Arabic-Indic digits)
 *
 * Rejecting four of those to enforce the fifth would be a validation rule that
 * fights its users. Normalising accepts all of them and stores one.
 *
 * A number that already carries some other country code is left alone — the
 * platform is Emirati but an owner may perfectly well have a Saudi or Omani
 * number, and silently rewriting it would send guests to the wrong person.
 */

/** UAE country calling code — the default when a bare local number is entered. */
export const DEFAULT_COUNTRY_CODE = "971";

/**
 * E.164 allows 8–15 digits including the country code.
 *
 * Deliberately permissive about *which* country: whether a number is a real,
 * reachable line is something only sending a message can establish, and
 * rejecting valid foreign numbers to enforce a guess would be worse than
 * accepting an unusual one.
 */
export const PHONE_MIN_DIGITS = 8;
export const PHONE_MAX_DIGITS = 15;

/**
 * Turn whatever was typed into the canonical stored form.
 *
 * Returns "" for anything that cannot be a phone number; callers must treat ""
 * as "no number available" rather than rendering a bare `wa.me/` link or
 * writing an empty username.
 */
export function normalizePhone(
  raw: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY_CODE,
): string {
  const input = normalizeDigits(String(raw ?? "")).trim();
  if (!input) return "";

  // Note whether it was written in an explicitly international form before
  // stripping the punctuation that carries that information.
  const hadPlus = input.startsWith("+");
  let digits = input.replace(/[^0-9]/g, "");
  if (!digits) return "";

  if (digits.startsWith("00")) {
    // "00" is the ITU international access prefix — equivalent to a leading "+".
    digits = digits.slice(2);
  } else if (hadPlus) {
    // Already international; nothing to add.
  } else if (digits.startsWith("0")) {
    // National trunk prefix: drop the 0 and prepend the country code.
    digits = countryCode + digits.slice(1);
  } else if (!digits.startsWith(countryCode)) {
    // A bare national number (no trunk 0, no country code). The country code is
    // assumed only for lengths that plausibly *are* one: UAE national
    // significant numbers are 9 digits for a mobile (5X XXX XXXX) and 8 for a
    // landline (4 XXX XXXX).
    //
    // This used to accept anything up to 10 digits, which quietly manufactured
    // valid-looking numbers out of nonsense: "12345" became "97112345" — eight
    // digits, so `isValidPhone` waved it through, and once the phone number
    // became a username that was a login nobody could ever have typed. Anything
    // longer is left alone: it may already carry a foreign country code, and
    // guessing +971 would point guests at a different person's phone.
    if (digits.length === 8 || digits.length === 9) digits = countryCode + digits;
  }

  return digits;
}

/** Is this a usable phone number once normalised? */
export function isValidPhone(raw: string | null | undefined): boolean {
  const digits = normalizePhone(raw);
  return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
}

/**
 * Which half of `isValidPhone` failed, so a form can say something more useful
 * than "invalid". "" is reported as incomplete rather than invalid: an empty
 * field is a missing answer, not a wrong one.
 */
export function phoneProblem(
  raw: string | null | undefined,
): "incomplete" | "invalid" | null {
  const digits = normalizePhone(raw);
  if (digits.length < PHONE_MIN_DIGITS) return "incomplete";
  if (digits.length > PHONE_MAX_DIGITS) return "invalid";
  return null;
}

/**
 * Format a number for *display*, grouped the way a UAE number is written:
 * "971503322119" → "971 50 332 2119". Anything else renders as bare digits.
 *
 * No "+" — the whole application, from the registration placeholder to the
 * owner's sign-in username, presents numbers in the plus-less form, and a
 * display that adds one would teach owners to type a character their username
 * does not contain.
 */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  const digits = normalizePhone(raw);
  if (!digits) return "";
  if (digits.startsWith(DEFAULT_COUNTRY_CODE) && digits.length === 12) {
    const rest = digits.slice(3);
    return `${DEFAULT_COUNTRY_CODE} ${rest.slice(0, 2)} ${rest.slice(2, 5)} ${rest.slice(5)}`;
  }
  return digits;
}

/**
 * The example shown in placeholders and hints, in the exact shape we store.
 *
 * Exported as a constant rather than typed into each form so that all of them
 * teach the same format — the one thing this module exists to make true.
 */
export const PHONE_EXAMPLE = "971503322119";
