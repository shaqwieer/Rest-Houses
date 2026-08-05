import { arFullDate, type ISODate } from "./dates";
import { arNum, whatsappDigits } from "./format";
import { formatPhoneDisplay, isValidPhone, normalizePhone } from "./phone";
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

/**
 * A WhatsApp number is a phone number, so all three of these are now the
 * canonical helpers in src/lib/phone.ts under their original names.
 *
 * They were duplicated here first, which is how `OwnerProfile.whatsapp` came to
 * be stored normalised while `OwnerProfile.phone` was stored exactly as typed —
 * the same value in two shapes in two adjacent columns. One implementation
 * means the number an owner signs in with, the number on their listings and the
 * number in the admin table cannot drift apart.
 *
 * Kept as aliases rather than renamed at the call sites: these names read
 * correctly where a WhatsApp link is specifically what is being built, and a
 * tree-wide rename would be churn with no behavioural payoff.
 */
export const normalizeWhatsapp = normalizePhone;
export const isValidWhatsapp = isValidPhone;
export const formatWhatsappDisplay = formatPhoneDisplay;

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
  /** A day booking (حجز بدون مبيت) — one day, no nights. */
  dayUse?: boolean;
  /** The hour the day guest must leave by, if the owner set one. */
  dayUseCheckOutTime?: string | null;
  guests: number;
  customerName: string;
  customerPhone: string;
  total: number;
  depositDue?: number;
  depositPercent?: number;
  /** Refundable security deposit, from the booking's own snapshot. */
  securityDeposit?: number;
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

  // A day booking says so in its own words. The owner reads this message on a
  // phone and acts on it — telling them "check-out: 28 July, nights: 0" for a
  // guest arriving and leaving that morning is how somebody's whole day gets
  // held for a stay that was never requested.
  const stayLines = input.dayUse
    ? [
        `${mark}${t.dayUseDate(arFullDate(input.checkIn, locale))}`,
        `${mark}${t.dayUseNoOvernight}`,
        ...(input.dayUseCheckOutTime
          ? [`${mark}${t.dayUseLeaveBy(input.dayUseCheckOutTime)}`]
          : []),
      ]
    : [
        `${mark}${t.checkIn(arFullDate(input.checkIn, locale))}`,
        `${mark}${t.checkOut(arFullDate(input.checkOut, locale))}`,
        `${mark}${t.nights(n(input.nights))}`,
      ];

  const lines: string[] = [
    `${mark}${t.greeting}`,
    `${mark}${t.bookingIntro(input.listingName)}${area}`,
    "",
    `${mark}${t.reference(input.reference)}`,
    ...stayLines,
    `${mark}${t.guests(n(input.guests))}`,
    `${mark}${t.total(n(input.total))}`,
  ];

  // The deposit line is omitted entirely when none is due, rather than sent as
  // "0%" — a guest reading "deposit 0%" wonders whether something is broken.
  if (input.depositDue && input.depositDue > 0) {
    lines.push(`${mark}${t.deposit(n(input.depositPercent ?? 0), n(input.depositDue))}`);
  }

  // Same rule for the refundable security deposit: it goes in the message when
  // there is one, so the owner and the guest are working from the same figure
  // when they settle up, and is absent entirely when there isn't.
  if (input.securityDeposit && input.securityDeposit > 0) {
    lines.push(`${mark}${t.securityDeposit(n(input.securityDeposit))}`);
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
