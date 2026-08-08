import { DEFAULT_LOCALE, localized, type Locale } from "./i18n/config";
import {
  DEFAULT_CHECK_IN_HOUR,
  DEFAULT_CHECK_OUT_HOUR,
  formatHour,
  isStayHour,
} from "./clock";

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

/* -------------------------------------------------------------------------- */
/* The cancellation policy                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What an owner may say about cancelling, as a fixed list.
 *
 * ─── Why this is not just a number of hours ──────────────────────────────────
 * It was one: `freeCancelHours`, any integer 0…720, typed into a box. Two
 * things went wrong with that. Owners typed whatever they liked, so the
 * catalogue advertised windows nobody had agreed on; and "ask me" — which is
 * how a lot of these arrangements genuinely work here — is not expressible as a
 * number at all. There is no integer that means "talk to me about it".
 *
 * The tempting fix is a sentinel, `-1` for ASK. It does not survive contact
 * with `clampHours`, which floors at 0 — so ASK would quietly become "no free
 * cancellation", turning "let's discuss it" into a refusal on the owner's
 * behalf. That is the same class of bug the null/0 note below warns about, with
 * a worse outcome, so the answer is a named mode instead of an overloaded
 * number. Modelled on `weekendMode` (src/lib/dates.ts): a String column with a
 * read-side normaliser, not a native enum.
 *
 * ─── "" is still "inherit", and the old number is still read ─────────────────
 * The list an owner picks from has no "use the platform's window" entry — they
 * choose one of six real answers. But every listing that predates the list is
 * NULL, meaning inherit, and backfilling those to 48 hours would freeze today's
 * platform figure onto the whole catalogue and quietly delete the inheritance.
 * So "" survives as an unlisted state for rows nobody has touched, and
 * `freeCancelHours` survives as the middle tier — exactly the arrangement the
 * stay times use. See `resolveCancelPolicy`.
 */
export const CANCEL_POLICIES = ["NONE", "H24", "H48", "H72", "H120", "ASK"] as const;

export type CancelPolicyId = (typeof CANCEL_POLICIES)[number];

/** Hours for the four that are a window; 0 for NONE; null for ASK. */
const CANCEL_POLICY_HOURS: Record<CancelPolicyId, number | null> = {
  NONE: 0,
  H24: 24,
  H48: 48,
  H72: 72,
  H120: 120,
  ASK: null,
};

/**
 * The resolved answer, as a tagged value rather than a number.
 *
 * Every display site branches on `kind`. Returning a number and asking each of
 * them to remember that 0 means "none" and some other value means "ask" is how
 * the sentinel bug gets reintroduced one call site at a time.
 */
export type ResolvedCancelPolicy =
  | { kind: "hours"; hours: number }
  | { kind: "none" }
  | { kind: "ask" };

/** "" and anything unrecognised → null, i.e. "nothing chosen from the list". */
export function toCancelPolicy(value: unknown): CancelPolicyId | null {
  return typeof value === "string" && (CANCEL_POLICIES as readonly string[]).includes(value)
    ? (value as CancelPolicyId)
    : null;
}

/** The stored hour count for a mode, for the audit script and for tests. */
export function cancelPolicyHours(id: CancelPolicyId): number | null {
  return CANCEL_POLICY_HOURS[id];
}

/** The mode a plain hour count corresponds to exactly, or null if none does. */
export function cancelPolicyForHours(hours: number | null | undefined): CancelPolicyId | null {
  if (hours === null || hours === undefined) return null;
  return (
    CANCEL_POLICIES.find((id) => CANCEL_POLICY_HOURS[id] === hours) ?? null
  );
}

/**
 * What this listing says about cancelling.
 *
 * Three tiers, the same shape as `resolveStayTimes`:
 *
 *   1. the listing's chosen mode      — picked from the list
 *   2. the listing's `freeCancelHours` — typed, before the list existed
 *   3. the platform's window
 *
 * Tier 2 is why an un-migrated listing keeps advertising exactly what it
 * advertises today, including the awkward numbers (37 hours, 100 hours) that no
 * mode covers. Converting those by rounding would change a published promise a
 * guest may already have read.
 */
export function resolveCancelPolicy(
  listing: { cancelPolicy?: string | null; freeCancelHours?: number | null },
  platform: { freeCancelHours: number },
): ResolvedCancelPolicy {
  const chosen = toCancelPolicy(listing.cancelPolicy);
  if (chosen === "ASK") return { kind: "ask" };
  if (chosen) {
    const hours = CANCEL_POLICY_HOURS[chosen] ?? 0;
    return hours > 0 ? { kind: "hours", hours } : { kind: "none" };
  }

  const hours = resolveFreeCancelHours(listing.freeCancelHours, platform.freeCancelHours);
  return hours > 0 ? { kind: "hours", hours } : { kind: "none" };
}

/** The platform-level halves of the policy, as `getSettings()` returns them. */
type PlatformPolicy = {
  checkInHour?: number | null;
  checkOutHour?: number | null;
  /** Legacy free text, still read when the hour beside it is null. */
  checkInTime: string;
  checkInTimeEn?: string | null;
  checkOutTime: string;
  checkOutTimeEn?: string | null;
  freeCancelHours: number;
};

/** The listing's own overrides. null / "" everywhere = "inherit everything". */
type ListingPolicy = {
  cancelPolicy?: string | null;
  checkInHour?: number | null;
  checkOutHour?: number | null;
  checkInTime?: string | null;
  checkInTimeEn?: string | null;
  checkOutTime?: string | null;
  checkOutTimeEn?: string | null;
  freeCancelHours?: number | null;
};

/** Just the day-use half, which follows a different rule — see below. */
type DayUsePolicy = {
  dayUseCheckOutHour?: number | null;
  dayUseCheckOutTime?: string | null;
  dayUseCheckOutTimeEn?: string | null;
};

/**
 * One stay time, from whichever of its two storage forms is populated.
 *
 * The hour wins when it is set, because it is the answer somebody chose from a
 * list and it renders correctly in both languages. Otherwise the old free text
 * answers, in whichever language it has — that is a row nobody has migrated
 * yet, and its text is still the truth about that rest house.
 *
 * Returns "" when neither is set, which is what lets the callers below stack
 * their own fallbacks with `||`.
 */
function stayTime(
  hour: number | null | undefined,
  legacyArabic: string | null | undefined,
  legacyEnglish: string | null | undefined,
  locale: Locale,
): string {
  if (isStayHour(hour)) return formatHour(hour, locale);
  return localized(legacyArabic, legacyEnglish, locale);
}

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
 * Three tiers stack here and the order matters:
 *
 *   1. the listing's own hour        — an owner picked it from the list
 *   2. the listing's own legacy text — an owner typed it, before the list
 *   3. the platform's answer         — tiers 1 and 2 again, on the settings row
 *
 * and a hard-coded hour underneath all of it, for the case where a settings row
 * has been cleared to nothing.
 *
 * What must not happen is tier 3 jumping the queue. An owner who set only their
 * own text, in only Arabic, still gets *their* hour on the English page rather
 * than the platform's — showing the platform's would tell an English reader an
 * arrival hour that is simply wrong for that rest house, where the Arabic one
 * is at least true. That rule predates the hour columns and survives them.
 */
export function resolveStayTimes(
  listing: ListingPolicy,
  platform: PlatformPolicy,
  locale: Locale = DEFAULT_LOCALE,
): { checkInTime: string; checkOutTime: string } {
  return {
    checkInTime:
      stayTime(listing.checkInHour, listing.checkInTime, listing.checkInTimeEn, locale) ||
      stayTime(platform.checkInHour, platform.checkInTime, platform.checkInTimeEn, locale) ||
      formatHour(DEFAULT_CHECK_IN_HOUR, locale),
    checkOutTime:
      stayTime(listing.checkOutHour, listing.checkOutTime, listing.checkOutTimeEn, locale) ||
      stayTime(platform.checkOutHour, platform.checkOutTime, platform.checkOutTimeEn, locale) ||
      formatHour(DEFAULT_CHECK_OUT_HOUR, locale),
  };
}

/**
 * The hour a day-use guest must be out by — or "" when day bookings are not
 * offered at all.
 *
 * Note what is missing: there is no platform tier, and that is the whole point
 * of keeping this separate from `resolveStayTimes`. For arrival and departure,
 * "unset" means "whatever the platform says". Here it means "this rest house
 * does not take day bookings" — most of the catalogue — and falling back would
 * print a leave-by hour on every one of them for a booking they do not accept.
 * The listing page and the calendar both key off the empty string to hide the
 * line entirely, so "" is a real answer here rather than a missing one.
 */
export function resolveDayUseCheckOut(
  listing: DayUsePolicy,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return stayTime(
    listing.dayUseCheckOutHour,
    listing.dayUseCheckOutTime,
    listing.dayUseCheckOutTimeEn,
    locale,
  );
}

/**
 * What a blank policy field on a listing resolves to, in one locale.
 *
 * Handed to the listing editor, which names it inside the "use the platform's
 * time" option itself. "Leave this one alone for the default" is not usable
 * advice when the default is invisible — an owner would have to guess what the
 * platform says before deciding whether their own hour differs from it.
 */
export function platformPolicyFor(platform: PlatformPolicy, locale: Locale = DEFAULT_LOCALE) {
  return {
    checkInTime:
      stayTime(platform.checkInHour, platform.checkInTime, platform.checkInTimeEn, locale) ||
      formatHour(DEFAULT_CHECK_IN_HOUR, locale),
    checkOutTime:
      stayTime(platform.checkOutHour, platform.checkOutTime, platform.checkOutTimeEn, locale) ||
      formatHour(DEFAULT_CHECK_OUT_HOUR, locale),
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
    cancel: resolveCancelPolicy(listing, platform),
  };
}
