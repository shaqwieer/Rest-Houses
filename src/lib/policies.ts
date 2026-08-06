import { DEFAULT_LOCALE, localized, type Locale } from "./i18n/config";

/**
 * Per-listing stay policy — check-in, check-out and free cancellation.
 *
 * These three were platform-wide settings, printed identically on every listing
 * page. They are not platform-wide facts: one owner hands over the keys at 3pm
 * and another at 5pm, one allows a free cancellation up to two days out and
 * another none at all. Each rest house now stores its own, and falls back to
 * the platform's answer when it hasn't.
 *
 * Kept in its own module rather than in src/lib/listings.ts because that one
 * imports Prisma, and these resolve pure values that a test — or one day a
 * client component — must be able to import without dragging a database client
 * in with them. Same reason `resolveDepositPercent` sits in pricing.ts.
 */

/** The platform-level halves of the policy, as `getSettings()` returns them. */
type PlatformPolicy = {
  checkInTime: string;
  checkInTimeEn?: string | null;
  checkOutTime: string;
  checkOutTimeEn?: string | null;
  freeCancelHours: number;
};

/** The listing's own overrides. "" / null everywhere = "inherit everything". */
type ListingPolicy = {
  checkInTime?: string | null;
  checkInTimeEn?: string | null;
  checkOutTime?: string | null;
  checkOutTimeEn?: string | null;
  freeCancelHours?: number | null;
};

/**
 * How many hours before check-in this listing still allows a free cancellation.
 *
 * The null/0 distinction is the whole point, and it is the same trap
 * `resolveDepositPercent` documents:
 *   null → "I haven't set one; use the platform's figure"
 *   0    → "I allow no free cancellation"
 * `listing.freeCancelHours || settings.freeCancelHours` collapses those two and
 * publishes a 48-hour promise on behalf of an owner who explicitly refused to
 * make it — a promise the guest would then hold them to.
 *
 * Clamped to a sane range so a value that somehow bypassed validation (an old
 * row, a direct database edit) can't render a negative window.
 */
export function resolveFreeCancelHours(
  listingHours: number | null | undefined,
  platformDefault: number,
): number {
  const raw = listingHours === null || listingHours === undefined ? platformDefault : listingHours;
  if (!Number.isFinite(raw)) return clampHours(platformDefault);
  return clampHours(raw);
}

/** 0 … 720 hours (30 days), matching the bound the settings form enforces. */
export function clampHours(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(720, Math.max(0, Math.round(value)));
}

/**
 * The arrival and departure times to print for one listing, in one locale.
 *
 * Two fallbacks stack here and the order matters. First the listing's own value
 * for this locale (English column, then Arabic — `localized`'s own rule), and
 * only if the owner set *nothing* does the platform default apply. An owner who
 * filled in the Arabic time but not the English one gets their Arabic time on
 * the English page, not the platform's — showing the platform's would tell an
 * English reader an arrival hour that is simply wrong for that rest house,
 * where the Arabic one is at least true.
 */
export function resolveStayTimes(
  listing: ListingPolicy,
  platform: PlatformPolicy,
  locale: Locale = DEFAULT_LOCALE,
): { checkInTime: string; checkOutTime: string } {
  return {
    checkInTime:
      localized(listing.checkInTime, listing.checkInTimeEn, locale) ||
      localized(platform.checkInTime, platform.checkInTimeEn, locale),
    checkOutTime:
      localized(listing.checkOutTime, listing.checkOutTimeEn, locale) ||
      localized(platform.checkOutTime, platform.checkOutTimeEn, locale),
  };
}

/**
 * What a blank policy field on a listing resolves to, in one locale.
 *
 * Handed to the listing editor as the placeholder in each box. "Leave blank for
 * the default" is not usable advice when the default is free text the owner has
 * no way to see — they would have to guess whether the platform says "٤ عصرًا"
 * or "4 PM" before deciding whether their own hour differs from it.
 */
export function platformPolicyFor(platform: PlatformPolicy, locale: Locale = DEFAULT_LOCALE) {
  return {
    checkInTime: localized(platform.checkInTime, platform.checkInTimeEn, locale),
    checkOutTime: localized(platform.checkOutTime, platform.checkOutTimeEn, locale),
    freeCancelHours: platform.freeCancelHours,
  };
}

/** Both halves at once, for the pages that print all three figures. */
export function resolveListingPolicy(
  listing: ListingPolicy,
  platform: PlatformPolicy,
  locale: Locale = DEFAULT_LOCALE,
) {
  return {
    ...resolveStayTimes(listing, platform, locale),
    freeCancelHours: resolveFreeCancelHours(listing.freeCancelHours, platform.freeCancelHours),
  };
}
