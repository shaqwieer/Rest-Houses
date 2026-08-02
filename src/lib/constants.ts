import { DEFAULT_LOCALE, type Locale } from "./i18n/config";

/**
 * Domain vocabulary — amenities, cities, categories and status values.
 *
 * These are the single source of truth for anything stored as an *id* in the
 * database (`Listing.amenities`, `Listing.categories`, `Listing.city`,
 * `BookingRequest.status`, `OwnerProfile.status`, …). Ids are stable ASCII; only
 * the labels here are user-facing, so re-wording a label — in either language —
 * never invalidates stored data.
 *
 * Each entry carries both an `ar` and an `en` label, resolved through
 * `label(entry, locale)`. Every lookup helper takes an optional trailing
 * `locale` that defaults to Arabic, so pre-existing call sites keep their exact
 * previous behaviour.
 *
 * `icon` is a Material Symbols Rounded ligature name, matching the design.
 */

/** Anything with a label in both languages. */
export type Localized = { ar: string; en: string };

/** Pick the label for a locale. Falls back to Arabic if English is blank. */
export function label(entry: Localized, locale: Locale = DEFAULT_LOCALE): string {
  return locale === "en" ? entry.en || entry.ar : entry.ar;
}

export type Amenity = { id: string; ar: string; en: string; icon: string };

/** Order matters: this is the order chips render in filters and the editor. */
export const AMENITIES: readonly Amenity[] = [
  { id: "pool", ar: "مسبح خاص", en: "Private pool", icon: "pool" },
  { id: "wifi", ar: "إنترنت لاسلكي", en: "Wi-Fi", icon: "wifi" },
  { id: "ac", ar: "تكييف مركزي", en: "Central A/C", icon: "ac_unit" },
  { id: "park", ar: "مواقف واسعة", en: "Ample parking", icon: "local_parking" },
  { id: "bbq", ar: "ركن الشواء", en: "Barbecue area", icon: "outdoor_grill" },
  { id: "kitchen", ar: "مطبخ مجهّز", en: "Equipped kitchen", icon: "kitchen" },
  { id: "majlis", ar: "مجلس عربي", en: "Arabic majlis", icon: "weekend" },
  { id: "pitch", ar: "ملعب كرة", en: "Football pitch", icon: "sports_soccer" },
  { id: "kids", ar: "ألعاب أطفال", en: "Children's play area", icon: "toys" },
  { id: "wc", ar: "دورات مياه", en: "Washrooms", icon: "wc" },
  { id: "tent", ar: "خيمة شتوية", en: "Winter tent", icon: "cabin" },
  { id: "sound", ar: "نظام صوتي", en: "Sound system", icon: "speaker" },
  { id: "screen", ar: "شاشة عرض", en: "Projector screen", icon: "tv" },
  { id: "cctv", ar: "كاميرات مراقبة", en: "CCTV", icon: "videocam" },
  { id: "palm", ar: "نخيل وحديقة", en: "Palms & garden", icon: "park" },
  { id: "fire", ar: "وجار ونار", en: "Fire pit", icon: "local_fire_department" },
] as const;

const AMENITY_BY_ID = new Map(AMENITIES.map((a) => [a.id, a]));

/** Never throws: an unknown id (e.g. removed from this list after being saved)
 *  degrades to a generic chip rather than blanking the card. */
export function getAmenity(id: string): Amenity {
  return AMENITY_BY_ID.get(id) ?? { id, ar: id, en: id, icon: "check" };
}

export function getAmenities(ids: string[]): Amenity[] {
  return ids.map(getAmenity);
}

export function amenityLabel(id: string, locale: Locale = DEFAULT_LOCALE): string {
  return label(getAmenity(id), locale);
}

export type Category = { id: string; ar: string; en: string; icon: string };

export const CATEGORIES: readonly Category[] = [
  { id: "family", ar: "عائلية", en: "Family", icon: "diversity_3" },
  { id: "wedding", ar: "أعراس ومناسبات", en: "Weddings & events", icon: "celebration" },
  { id: "small", ar: "تجمعات صغيرة", en: "Small gatherings", icon: "groups" },
  { id: "camp", ar: "مخيمات شتوية", en: "Winter camps", icon: "cabin" },
  { id: "swim", ar: "استراحات بمسبح", en: "With a pool", icon: "pool" },
  { id: "lux", ar: "شاليهات فاخرة", en: "Luxury chalets", icon: "diamond" },
] as const;

const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string): Category {
  return CATEGORY_BY_ID.get(id) ?? { id, ar: id, en: id, icon: "label" };
}

export function categoryLabel(id: string, locale: Locale = DEFAULT_LOCALE): string {
  return label(getCategory(id), locale);
}

export type City = { id: string; ar: string; en: string };

/**
 * The seven emirates.
 *
 * This list is the *emirate*, not the town. It previously mixed the two —
 * "العين" and "الظفرة وليوا" are regions inside Abu Dhabi, so a visitor
 * filtering by "أبوظبي" would not see a rest house in Al Ain even though it is
 * in that emirate. Splitting a level of geography across the same dropdown makes
 * the filter quietly lossy.
 *
 * Town-level detail has a home already: `Listing.area` is free text and holds
 * "لهباب – دبي", "ليوا – الظفرة", "العين – الهيلي". That is what the card and
 * the detail page show, so nothing is lost by making this list the emirates.
 *
 * Ids are stable ASCII and are what `Listing.city` and `OwnerProfile.city`
 * store, so re-wording a label never invalidates data. The two ids that were
 * removed (`alain`, `liwa`) were remapped to `abudhabi` by the migration
 * `20260802..._emirates_city_list` — the emirate those regions belong to.
 */
export const CITIES: readonly City[] = [
  { id: "abudhabi", ar: "أبوظبي", en: "Abu Dhabi" },
  { id: "dubai", ar: "دبي", en: "Dubai" },
  { id: "sharjah", ar: "الشارقة", en: "Sharjah" },
  { id: "rak", ar: "رأس الخيمة", en: "Ras Al Khaimah" },
  { id: "ajman", ar: "عجمان", en: "Ajman" },
  { id: "uaq", ar: "أم القيوين", en: "Umm Al Quwain" },
  { id: "fujairah", ar: "الفجيرة", en: "Fujairah" },
] as const;

/**
 * Ids that no longer exist, and what they became.
 *
 * Kept so a bookmarked `/listings?city=alain` link still lands somewhere
 * sensible rather than silently returning nothing — `normalizeCityId` below
 * translates it. Remove this once no such links can plausibly be in circulation.
 */
const RETIRED_CITY_IDS: Record<string, string> = {
  alain: "abudhabi", // Al Ain is a region of Abu Dhabi
  liwa: "abudhabi", // Liwa / Al Dhafra likewise
};

/**
 * Map a possibly-retired city id onto a current one.
 *
 * Anything unrecognised passes through untouched, so a garbage query string
 * still simply matches nothing rather than being coerced into a real emirate.
 */
export function normalizeCityId(id: string | undefined | null): string | undefined {
  if (!id) return undefined;
  return RETIRED_CITY_IDS[id] ?? id;
}

const CITY_BY_ID = new Map(CITIES.map((c) => [c.id, c]));

export function cityLabel(id: string, locale: Locale = DEFAULT_LOCALE): string {
  const city = CITY_BY_ID.get(id);
  return city ? label(city, locale) : "—";
}

/* --------------------------------------------------------------------------
 * Status values. Kept as string unions rather than Prisma enums — originally
 * because the datasource was SQLite, retained because adding a value stays a
 * code change instead of an `ALTER TYPE` that locks the table. Validate with
 * the guards below whenever a value arrives from a form or query string.
 * -------------------------------------------------------------------------- */

export const BOOKING_STATUSES = ["NEW", "CONFIRMED", "REJECTED", "CANCELLED"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export function isBookingStatus(v: unknown): v is BookingStatus {
  return typeof v === "string" && (BOOKING_STATUSES as readonly string[]).includes(v);
}

/**
 * Arabic-only status labels, kept for the handful of Arabic-by-construction
 * call sites. Translated UI reads `t.status[status]` from the dictionary
 * instead, which covers both languages.
 */
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  NEW: "جديد",
  CONFIRMED: "مؤكد",
  REJECTED: "مرفوض",
  CANCELLED: "ملغى",
};

export const AVAILABILITY_STATUSES = ["BLOCKED", "BOOKED"] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

/* --------------------------------------------------------------------------
 * Roles and owner lifecycle
 * -------------------------------------------------------------------------- */

export const ROLES = ["ADMIN", "OWNER"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

/**
 * OwnerProfile.status.
 *
 * Note what is NOT here: "EXPIRED". Expiry is derived from
 * `membershipExpiresAt` at query time, never stored as a status — otherwise
 * something would have to sweep the table at midnight to flip owners over, and
 * an owner whose membership lapsed and was then renewed would need that flip
 * undone. `ownerAccessState()` in src/lib/owners.ts combines the stored status
 * and the expiry date into the single value the UI displays.
 */
export const OWNER_STATUSES = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"] as const;
export type OwnerStatus = (typeof OWNER_STATUSES)[number];

export function isOwnerStatus(v: unknown): v is OwnerStatus {
  return typeof v === "string" && (OWNER_STATUSES as readonly string[]).includes(v);
}

/** What the UI shows: the stored status, plus the derived expiry case. */
export const OWNER_ACCESS_STATES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
  "EXPIRED",
] as const;
export type OwnerAccessState = (typeof OWNER_ACCESS_STATES)[number];

export const PAYMENT_STATUSES = ["NONE", "PENDING", "PAID", "REFUNDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function isPaymentStatus(v: unknown): v is PaymentStatus {
  return typeof v === "string" && (PAYMENT_STATUSES as readonly string[]).includes(v);
}

/* --------------------------------------------------------------------------
 * Audit actions — the vocabulary written to AuditLog.action.
 * -------------------------------------------------------------------------- */

export const AUDIT_ACTIONS = [
  "OWNER_REGISTERED",
  "OWNER_APPROVED",
  "OWNER_REJECTED",
  "OWNER_SUSPENDED",
  "OWNER_ACTIVATED",
  "MEMBERSHIP_UPDATED",
  "LISTING_CREATED",
  "LISTING_UPDATED",
  "LISTING_DELETED",
  "LISTING_VISIBILITY_CHANGED",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/* -------------------------------------------------------------------------- */

/** Deposit percentage bounds — enforced server-side wherever one is accepted. */
export const DEPOSIT_PERCENT_MIN = 0;
export const DEPOSIT_PERCENT_MAX = 100;

/** Sort options for the listings page — ids appear in the URL (?sort=low). */
export const SORT_OPTIONS = [
  { id: "reco", ar: "الأنسب لك", en: "Best match" },
  { id: "low", ar: "الأقل سعرًا", en: "Lowest price" },
  { id: "high", ar: "الأعلى سعرًا", en: "Highest price" },
  { id: "rated", ar: "الأعلى تقييمًا", en: "Top rated" },
  { id: "cap", ar: "الأكبر سعة", en: "Largest capacity" },
] as const;

export type SortId = (typeof SORT_OPTIONS)[number]["id"];

export function isSortId(v: unknown): v is SortId {
  return typeof v === "string" && SORT_OPTIONS.some((s) => s.id === v);
}

/** Price-filter bounds — also the min/max of the range slider in the sidebar. */
export const PRICE_MIN = 800;
export const PRICE_MAX = 4000;
export const CAPACITY_MAX = 120;

/** Arabic month names, index 0 = January (matches Date#getMonth). */
export const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
] as const;

/** English month names, same indexing. */
export const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export function monthNames(locale: Locale = DEFAULT_LOCALE): readonly string[] {
  return locale === "en" ? MONTHS_EN : MONTHS_AR;
}

/** Day-of-week names, index 0 = Sunday (matches Date#getDay). */
export const DOW_AR = [
  "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت",
] as const;

export const DOW_EN = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

export function dayNames(locale: Locale = DEFAULT_LOCALE): readonly string[] {
  return locale === "en" ? DOW_EN : DOW_AR;
}

/** Short forms for the compact calendar headers. */
export const DOW_AR_SHORT = ["ح", "ن", "ث", "ر", "خ", "ج", "س"] as const;

export const DOW_EN_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

export function dayNamesShort(locale: Locale = DEFAULT_LOCALE): readonly string[] {
  return locale === "en" ? DOW_EN_SHORT : DOW_AR_SHORT;
}
