import { arFullDate, type ISODate } from "./dates";
import { arNum, normalizeDigits, whatsappDigits } from "./format";
import { getDictionary } from "./i18n";
import { DEFAULT_LOCALE, type Locale } from "./i18n/config";

/**
 * WhatsApp deep links.
 *
 * `https://wa.me/<digits>?text=<urlencoded message>` opens the native app (or
 * WhatsApp Web on desktop) with the message pre-typed but NOT sent — the guest
 * still presses send, which is what keeps this compliant and spam-free.
 *
 * Message text comes from the dictionary, so a guest browsing in English sends
 * the owner an English message and an Arabic browser sends Arabic.
 */

/* -------------------------------------------------------------------------- */
/* Number normalisation                                                       */
/* -------------------------------------------------------------------------- */

/** UAE country calling code — the default when a bare local number is entered. */
const DEFAULT_COUNTRY_CODE = "971";

/**
 * Turn whatever an owner typed into the digits `wa.me` expects.
 *
 * Handles the shapes people actually enter for an Emirati mobile:
 *   "+971 50 214 8890" → 971502148890   (already international)
 *   "00971502148890"   → 971502148890   (00 international prefix)
 *   "0502148890"       → 971502148890   (national trunk 0 → country code)
 *   "502148890"        → 971502148890   (bare national number)
 *   "٠٥٠٢١٤٨٨٩٠"        → 971502148890   (Arabic-Indic digits)
 *
 * A number that already carries some other country code is left alone — the
 * platform is Emirati but an owner may perfectly well have a Saudi or Omani
 * number, and silently rewriting it would send guests to the wrong person.
 *
 * Returns "" for anything that cannot be a phone number; callers must treat ""
 * as "no WhatsApp link available" rather than rendering a bare `wa.me/`.
 */
export function normalizeWhatsapp(
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
    // A bare national number (no trunk 0, no country code). Only assume the
    // default country for lengths that plausibly *are* national numbers —
    // anything long enough to already carry a foreign country code is left be.
    if (digits.length <= 10) digits = countryCode + digits;
  }

  return digits;
}

/**
 * Is this a usable WhatsApp number?
 *
 * E.164 allows 8–15 digits including the country code. Deliberately permissive
 * about *which* country: whether a number is a real, reachable line is
 * something only sending a message can establish, and rejecting valid foreign
 * numbers to enforce a guess would be worse than accepting an unusual one.
 */
export function isValidWhatsapp(raw: string | null | undefined): boolean {
  const digits = normalizeWhatsapp(raw);
  return digits.length >= 8 && digits.length <= 15;
}

/**
 * Format a number for *display*, grouped the way a UAE number is written.
 * "971502148890" → "+971 50 214 8890". Anything else renders as "+digits".
 */
export function formatWhatsappDisplay(raw: string | null | undefined): string {
  const digits = normalizeWhatsapp(raw);
  if (!digits) return "";
  if (digits.startsWith(DEFAULT_COUNTRY_CODE) && digits.length === 12) {
    const rest = digits.slice(3);
    return `+${DEFAULT_COUNTRY_CODE} ${rest.slice(0, 2)} ${rest.slice(2, 5)} ${rest.slice(5)}`;
  }
  return `+${digits}`;
}

/* -------------------------------------------------------------------------- */
/* Resolving which number a listing uses                                      */
/* -------------------------------------------------------------------------- */

/** The shape `resolveListingWhatsapp` needs — a listing plus its owner, if any. */
export type ListingContact = {
  ownerWhatsapp?: string | null;
  ownerName?: string | null;
  owner?: { whatsapp: string; fullName: string; businessName?: string | null } | null;
};

export type ResolvedContact = {
  /** Digits ready for a wa.me link, or "" when this listing has no number. */
  digits: string;
  /** Pretty form, for display beside a "call" affordance. */
  display: string;
  /** Who the guest will be messaging. */
  name: string;
};

/**
 * Which WhatsApp number a listing's contact buttons open.
 *
 * Precedence, and the reasoning for it:
 *
 *  1. **The owner's number, through the relation.** For an owned listing this is
 *     the only answer. It is read live rather than copied onto the listing, so
 *     an owner who changes their number in their profile changes every one of
 *     their listings at once — no per-listing edit, no stale duplicates, and no
 *     chance of two of their listings disagreeing.
 *
 *  2. The listing's own `ownerWhatsapp`, for platform-owned listings that
 *     predate the owner workflow.
 *
 *  3. The site-wide number — and **only** for a listing with no owner. An owned
 *     listing must never fall back to the platform's number: that would route a
 *     guest asking about someone's rest house to the platform operator, which is
 *     exactly the dependency requirement 4 exists to remove. An owned listing
 *     whose owner somehow has no usable number resolves to "" and its WhatsApp
 *     buttons are hidden rather than pointed somewhere wrong.
 */
export function resolveListingWhatsapp(
  listing: ListingContact,
  siteWhatsapp: string | null | undefined,
  fallbackOwnerLabel = "المالك",
): ResolvedContact {
  if (listing.owner) {
    return {
      digits: normalizeWhatsapp(listing.owner.whatsapp),
      display: formatWhatsappDisplay(listing.owner.whatsapp),
      name: listing.owner.businessName || listing.owner.fullName,
    };
  }

  const own = normalizeWhatsapp(listing.ownerWhatsapp);
  if (own) {
    return {
      digits: own,
      display: formatWhatsappDisplay(listing.ownerWhatsapp),
      name: listing.ownerName || fallbackOwnerLabel,
    };
  }

  return {
    digits: normalizeWhatsapp(siteWhatsapp),
    display: formatWhatsappDisplay(siteWhatsapp),
    name: listing.ownerName || fallbackOwnerLabel,
  };
}

/* -------------------------------------------------------------------------- */
/* Links                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Bare link with no message — used by "contact us" style affordances.
 *
 * Returns "" when the number is unusable, so a caller can hide the button
 * rather than render a link to `https://wa.me/` that opens nothing.
 */
export function whatsappLink(number: string | null | undefined, message?: string): string {
  const digits = whatsappDigits(String(number ?? ""));
  if (!digits) return "";
  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                   */
/* -------------------------------------------------------------------------- */

export type BookingMessageInput = {
  siteName: string;
  reference: string;
  listingName: string;
  listingArea?: string | null;
  listingUrl?: string;
  checkIn: ISODate;
  checkOut: ISODate;
  nights: number;
  guests: number;
  customerName: string;
  customerPhone: string;
  total: number;
  depositDue?: number;
  depositPercent?: number;
  notes?: string | null;
  locale?: Locale;
};

/**
 * The prefilled booking-request message.
 *
 * Written as explicit lines rather than a paragraph because WhatsApp preserves
 * newlines: the owner can read dates and guest count at a glance on a phone.
 *
 * In Arabic, `‏` (RIGHT-TO-LEFT MARK) prefixes every line so a line beginning
 * with a Latin or numeric token — "+971 50…", "RQ-2420" — isn't visually
 * reordered inside an otherwise RTL paragraph. English needs no such mark, and
 * adding one there would be a stray invisible character in every message.
 */
export function bookingRequestMessage(input: BookingMessageInput): string {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const t = getDictionary(locale).whatsapp;
  const mark = locale === "ar" ? "‏" : "";
  const n = (v: number) => arNum(v, locale);

  const area = input.listingArea ? ` — ${input.listingArea}` : "";

  const lines: string[] = [
    `${mark}${t.greeting}`,
    `${mark}${t.bookingIntro(input.listingName)}${area}`,
    "",
    `${mark}${t.reference(input.reference)}`,
    `${mark}${t.checkIn(arFullDate(input.checkIn, locale))}`,
    `${mark}${t.checkOut(arFullDate(input.checkOut, locale))}`,
    `${mark}${t.nights(n(input.nights))}`,
    `${mark}${t.guests(n(input.guests))}`,
    `${mark}${t.total(n(input.total))}`,
  ];

  // The deposit line is omitted entirely when none is due, rather than sent as
  // "0%" — a guest reading "deposit 0%" wonders whether something is broken.
  if (input.depositDue && input.depositDue > 0) {
    lines.push(`${mark}${t.deposit(n(input.depositPercent ?? 0), n(input.depositDue))}`);
  }

  lines.push(
    "",
    `${mark}${t.name(input.customerName)}`,
    `${mark}${t.phone(input.customerPhone)}`,
  );

  if (input.notes && input.notes.trim()) {
    lines.push("", `${mark}${t.notes(input.notes.trim())}`);
  }

  if (input.listingUrl) {
    lines.push("", `${mark}🔗 ${input.listingUrl}`);
  }

  lines.push("", `${mark}${t.sentVia(input.siteName)}`);

  return lines.join("\n");
}

/** Shorter message for the "ask us anything" CTA on the home page. */
export function generalEnquiryMessage(
  siteName: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const t = getDictionary(locale).whatsapp;
  const mark = locale === "ar" ? "‏" : "";
  return [
    `${mark}${t.greeting}`,
    `${mark}${t.enquiryIntro}`,
    `${mark}${t.enquiryDate}`,
    `${mark}${t.enquiryGuests}`,
    `${mark}${t.enquiryBudget}`,
    "",
    `${mark}${t.enquiryFrom(siteName)}`,
  ].join("\n");
}

/** Owner-side message: replying to a specific request from the dashboard. */
export function ownerReplyMessage(input: {
  siteName: string;
  customerName: string;
  reference: string;
  listingName: string;
  locale?: Locale;
}): string {
  const locale = input.locale ?? DEFAULT_LOCALE;
  const t = getDictionary(locale).whatsapp;
  const mark = locale === "ar" ? "‏" : "";
  return [
    `${mark}${t.ownerReplyGreeting(input.customerName)}`,
    `${mark}${t.ownerReplyIntro(input.reference, input.listingName)}`,
    "",
    `${mark}${input.siteName}`,
  ].join("\n");
}
