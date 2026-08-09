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

/* --------------------------------------------------------------------------
 * The stand-in photograph.
 *
 * Used wherever a real photo is missing: a listing whose owner has not uploaded
 * one yet, and the home page banner when no hero image has been set in
 * /admin/settings. A desert-and-skyline shot rather than a grey placeholder
 * box — a brand-new listing on the grid should look like a rest house, not like
 * a broken card, because the empty state is what an owner sees the minute after
 * they publish.
 *
 * A file in /public, deliberately, not a database row: it must render on a
 * fresh install with an empty `ListingImage` table, and it must never be
 * something an admin can accidentally delete from the gallery editor. It is
 * resolved at render time only — nothing ever writes this path into the
 * database, so the day an owner uploads a real photo it simply disappears with
 * no orphan row left behind.
 *
 * Kept at 1920px wide (~110 KB). The source was 7595px/4.9 MB, which the image
 * optimiser would have had to decode and re-encode for every card size on a
 * cold cache — on the single-core VPS this runs on, that is seconds of CPU for
 * a picture nobody chose.
 * -------------------------------------------------------------------------- */
export const DEFAULT_PHOTO_URL = "/default-photo.webp";

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

/* --------------------------------------------------------------------------
 * The booking handover workflow.
 *
 * `BookingRequest.stage` — where the owner has got to in settling one booking.
 * ORDER IS THE DATA HERE: "which step is this?" is `BOOKING_STAGES.indexOf`,
 * "is this step done?" is an index comparison, and the stepper renders by
 * mapping over this array. Reordering it renumbers the workflow; appending to
 * it is how a step gets added.
 *
 * Orthogonal to `BOOKING_STATUSES`, not an extension of it — `status` says
 * whether the booking holds the calendar, `stage` says how far the handover has
 * got. See the note on `stage` in prisma/schema.prisma for why they are two
 * columns.
 *
 *   DEPOSIT    1 — عربون + تأمين received; confirming closes the calendar
 *   BALANCE    2 — the rest of the booking value, due by check-in day
 *   CHECKOUT   3 — the guest has left
 *   INSPECTION 4 — the rest house has been checked over
 *   SECURITY   5 — the تأمين goes back, less any damages
 *   COMMISSION 6 — the owner remits the platform's cut; an operator confirms it
 *   REVIEW     7 — the guest gets a time-limited link to review the stay
 *   DONE         — nothing left to do
 * -------------------------------------------------------------------------- */
export const BOOKING_STAGES = [
  "DEPOSIT",
  "BALANCE",
  "CHECKOUT",
  "INSPECTION",
  "SECURITY",
  "COMMISSION",
  "REVIEW",
  "DONE",
] as const;
export type BookingStage = (typeof BOOKING_STAGES)[number];

export function isBookingStage(v: unknown): v is BookingStage {
  return typeof v === "string" && (BOOKING_STAGES as readonly string[]).includes(v);
}

/** The seven steps the owner actually works through — "DONE" is the terminus. */
export const WORKFLOW_STAGES = BOOKING_STAGES.filter((s) => s !== "DONE") as readonly Exclude<
  BookingStage,
  "DONE"
>[];

/**
 * 1-based step number, for display. Returns 0 for an unknown value rather than
 * -1+1 nonsense, so a row carrying a stage this build doesn't know about
 * degrades to "no step" instead of rendering a negative one.
 */
export function stageNumber(stage: string): number {
  const index = (BOOKING_STAGES as readonly string[]).indexOf(stage);
  return index < 0 ? 0 : index + 1;
}

/** Has `stage` already passed `step`? Used to tick completed steps. */
export function isStageComplete(stage: string, step: BookingStage): boolean {
  const at = (BOOKING_STAGES as readonly string[]).indexOf(stage);
  const of = (BOOKING_STAGES as readonly string[]).indexOf(step);
  return at >= 0 && of >= 0 && at > of;
}

/** The step after `stage`. "DONE" is its own successor — the sequence ends. */
export function nextStage(stage: BookingStage): BookingStage {
  const index = BOOKING_STAGES.indexOf(stage);
  return BOOKING_STAGES[Math.min(index + 1, BOOKING_STAGES.length - 1)];
}

/* --------------------------------------------------------------------------
 * Review moderation — `Review.status`.
 *
 * "APPROVED" is the default because every review that existed before guests
 * could submit their own was already published. See the note in the schema.
 * -------------------------------------------------------------------------- */
export const REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export function isReviewStatus(v: unknown): v is ReviewStatus {
  return typeof v === "string" && (REVIEW_STATUSES as readonly string[]).includes(v);
}

/** Rating bounds — a review must fall inside these, enforced server-side. */
export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;

/**
 * Availability.status — why a day is closed.
 *
 * "EXTERNAL" is a day imported from Airbnb/Booking.com by the iCal sync. It is
 * a third status rather than a flag on "BLOCKED", and that distinction is
 * load-bearing in the *delete* paths: `setRangeBlocked` frees a month with
 * `deleteMany({ status: "BLOCKED" })` and cancelling a booking releases its
 * nights with `deleteMany({ status: "BOOKED" })`. Because an imported day
 * carries neither status, both stay correct without being touched — a day
 * Airbnb has sold cannot be freed by an owner pressing "free the rest of the
 * month". Folding external days into "BLOCKED" would have moved the required
 * change into exactly those two delete calls, where forgetting one silently
 * re-opens a booked night.
 */
export const AVAILABILITY_STATUSES = ["BLOCKED", "BOOKED", "EXTERNAL"] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

/**
 * The two `Availability.status` values this platform owns.
 *
 * Everything that edits the calendar on behalf of a human filters on these, so
 * an imported day is never in scope: it belongs to the other platform and is
 * removed only by the feed that brought it.
 */
export const LOCAL_AVAILABILITY_STATUSES = ["BLOCKED", "BOOKED"] as const;

/**
 * `Availability.sourceKey` for a row this platform owns. Any other value is a
 * CalendarFeed id. See the note on the model in prisma/schema.prisma.
 */
export const LOCAL_SOURCE_KEY = "LOCAL";

/* --------------------------------------------------------------------------
 * External calendars — CalendarFeed.platform
 *
 * Named platforms rather than free text because the two that matter have
 * different quirks worth telling an owner about (where the URL lives, how often
 * it refreshes), and because the label has to be translatable. "OTHER" covers
 * Vrbo, Agoda, a channel manager's combined feed, or a plain Google Calendar —
 * all of which export the same .ics and need no code of their own.
 * -------------------------------------------------------------------------- */

export const CALENDAR_PLATFORMS = ["AIRBNB", "BOOKING", "OTHER"] as const;
export type CalendarPlatform = (typeof CALENDAR_PLATFORMS)[number];

export function isCalendarPlatform(v: unknown): v is CalendarPlatform {
  return typeof v === "string" && (CALENDAR_PLATFORMS as readonly string[]).includes(v);
}

/**
 * Platform names are proper nouns — "Airbnb" is "Airbnb" in both languages —
 * so these are not in the dictionaries. Only "OTHER" needs translating, and it
 * resolves through `t.calendar.platformOther` at the call site.
 */
export const CALENDAR_PLATFORM_NAMES: Record<CalendarPlatform, string> = {
  AIRBNB: "Airbnb",
  BOOKING: "Booking.com",
  OTHER: "",
};

/**
 * Transport for a CalendarFeed. One value today.
 *
 * Present so that adding an API-backed source later — a channel manager, or
 * partner access to one of the platforms — is a new value here and a new branch
 * in `syncFeed`, rather than a parallel table with its own availability
 * semantics. See the note on CalendarFeed in prisma/schema.prisma.
 */
export const CALENDAR_FEED_KINDS = ["ICAL"] as const;
export type CalendarFeedKind = (typeof CALENDAR_FEED_KINDS)[number];

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
  // An admin editing an owner's own details, and an admin setting their
  // password. Two actions rather than one because they answer different
  // questions in the log: "who changed this owner's WhatsApp number" and "who
  // has been able to sign in as this owner since". The password action records
  // that it happened and never what was set.
  "OWNER_UPDATED",
  "OWNER_PASSWORD_RESET",
  // The operator editing their OWN account, kept separate from the two above
  // for the reason those two are separate from each other: the log has to be
  // able to answer "who changed the admin sign-in address" without that being
  // indistinguishable from an admin editing somebody else's. The password entry
  // records that a change happened and never what was set.
  "ADMIN_ACCOUNT_UPDATED",
  "ADMIN_PASSWORD_CHANGED",
  "MEMBERSHIP_UPDATED",
  "LISTING_CREATED",
  "LISTING_UPDATED",
  "LISTING_DELETED",
  "LISTING_VISIBILITY_CHANGED",
  // The booking handover. One action for every step an owner completes, with
  // the amount they entered in `metadata` — this is where money is declared
  // received and returned, so who said what and when has to be recoverable
  // after the fact. `BOOKING_STAGE_ADVANCED` carries the step in its metadata
  // rather than getting seven action names, so adding a step to
  // BOOKING_STAGES stays a one-line change.
  "BOOKING_STAGE_ADVANCED",
  "BOOKING_STAGE_REVERTED",
  "BOOKING_COMMISSION_CONFIRMED",
  "REVIEW_INVITED",
  "REVIEW_APPROVED",
  "REVIEW_REJECTED",
  // External calendar sync. Which platform and which listing, never the URL —
  // an iCal export URL is a credential for the owner's account on the other
  // platform, and the audit log is readable by every operator.
  "CALENDAR_FEED_ADDED",
  "CALENDAR_FEED_REMOVED",
  // Minting a token publishes a calendar; rotating one revokes the published
  // URL and breaks whatever was importing it. Both are worth a line in the log
  // because both change who can read a listing's calendar.
  "CALENDAR_EXPORT_ENABLED",
  "CALENDAR_EXPORT_DISABLED",
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
