/**
 * Domain vocabulary — amenities, cities, categories and status values.
 *
 * These are the single source of truth for anything stored as an *id* in the
 * database (`Listing.amenities`, `Listing.categories`, `Listing.city`,
 * `BookingRequest.status`, …). Ids are stable ASCII; only the Arabic labels
 * here are user-facing, so re-wording a label never invalidates stored data.
 *
 * `icon` is a Material Symbols Rounded ligature name, matching the design.
 */

export type Amenity = { id: string; ar: string; icon: string };

/** Order matters: this is the order chips render in filters and the editor. */
export const AMENITIES: readonly Amenity[] = [
  { id: "pool", ar: "مسبح خاص", icon: "pool" },
  { id: "wifi", ar: "إنترنت لاسلكي", icon: "wifi" },
  { id: "ac", ar: "تكييف مركزي", icon: "ac_unit" },
  { id: "park", ar: "مواقف واسعة", icon: "local_parking" },
  { id: "bbq", ar: "ركن الشواء", icon: "outdoor_grill" },
  { id: "kitchen", ar: "مطبخ مجهّز", icon: "kitchen" },
  { id: "majlis", ar: "مجلس عربي", icon: "weekend" },
  { id: "pitch", ar: "ملعب كرة", icon: "sports_soccer" },
  { id: "kids", ar: "ألعاب أطفال", icon: "toys" },
  { id: "wc", ar: "دورات مياه", icon: "wc" },
  { id: "tent", ar: "خيمة شتوية", icon: "cabin" },
  { id: "sound", ar: "نظام صوتي", icon: "speaker" },
  { id: "screen", ar: "شاشة عرض", icon: "tv" },
  { id: "cctv", ar: "كاميرات مراقبة", icon: "videocam" },
  { id: "palm", ar: "نخيل وحديقة", icon: "park" },
  { id: "fire", ar: "وجار ونار", icon: "local_fire_department" },
] as const;

const AMENITY_BY_ID = new Map(AMENITIES.map((a) => [a.id, a]));

/** Never throws: an unknown id (e.g. removed from this list after being saved)
 *  degrades to a generic chip rather than blanking the card. */
export function getAmenity(id: string): Amenity {
  return AMENITY_BY_ID.get(id) ?? { id, ar: id, icon: "check" };
}

export function getAmenities(ids: string[]): Amenity[] {
  return ids.map(getAmenity);
}

export type Category = { id: string; ar: string; icon: string };

export const CATEGORIES: readonly Category[] = [
  { id: "family", ar: "عائلية", icon: "diversity_3" },
  { id: "wedding", ar: "أعراس ومناسبات", icon: "celebration" },
  { id: "small", ar: "تجمعات صغيرة", icon: "groups" },
  { id: "camp", ar: "مخيمات شتوية", icon: "cabin" },
  { id: "swim", ar: "استراحات بمسبح", icon: "pool" },
  { id: "lux", ar: "شاليهات فاخرة", icon: "diamond" },
] as const;

const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string): Category {
  return CATEGORY_BY_ID.get(id) ?? { id, ar: id, icon: "label" };
}

export type City = { id: string; ar: string };

export const CITIES: readonly City[] = [
  { id: "dubai", ar: "دبي" },
  { id: "abudhabi", ar: "أبوظبي" },
  { id: "alain", ar: "العين" },
  { id: "liwa", ar: "الظفرة وليوا" },
  { id: "sharjah", ar: "الشارقة" },
] as const;

const CITY_BY_ID = new Map(CITIES.map((c) => [c.id, c]));

export function cityLabel(id: string): string {
  return CITY_BY_ID.get(id)?.ar ?? "—";
}

/* --------------------------------------------------------------------------
 * Status values. Kept as string unions rather than Prisma enums because the
 * default datasource is SQLite (no native enum). Validate with the guards
 * below whenever a value arrives from a form or query string.
 * -------------------------------------------------------------------------- */

export const BOOKING_STATUSES = ["NEW", "CONFIRMED", "REJECTED", "CANCELLED"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export function isBookingStatus(v: unknown): v is BookingStatus {
  return typeof v === "string" && (BOOKING_STATUSES as readonly string[]).includes(v);
}

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  NEW: "جديد",
  CONFIRMED: "مؤكد",
  REJECTED: "مرفوض",
  CANCELLED: "ملغى",
};

export const AVAILABILITY_STATUSES = ["BLOCKED", "BOOKED"] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

/** Sort options for the listings page — ids appear in the URL (?sort=low). */
export const SORT_OPTIONS = [
  { id: "reco", ar: "الأنسب لك" },
  { id: "low", ar: "الأقل سعرًا" },
  { id: "high", ar: "الأعلى سعرًا" },
  { id: "rated", ar: "الأعلى تقييمًا" },
  { id: "cap", ar: "الأكبر سعة" },
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

/** Day-of-week names, index 0 = Sunday (matches Date#getDay). */
export const DOW_AR = [
  "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت",
] as const;

/** Short forms for the compact admin calendar header. */
export const DOW_AR_SHORT = ["ح", "ن", "ث", "ر", "خ", "ج", "س"] as const;
