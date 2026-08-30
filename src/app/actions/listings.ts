"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireApprovedOwner, AuthorizationError } from "@/lib/auth";
import { getTakenSlugs } from "@/lib/listings";
import { uniqueSlug } from "@/lib/slug";
import { stringifyIdList } from "@/lib/json-list";
import { auditData } from "@/lib/audit";
import {
  AMENITIES,
  CATEGORIES,
  CITIES,
  DEPOSIT_PERCENT_MAX,
  DEPOSIT_PERCENT_MIN,
} from "@/lib/constants";
import { DEFAULT_WEEKEND_MODE, WEEKEND_MODES } from "@/lib/dates";
import { deleteStoredAsset, getStorage, UploadError } from "@/lib/storage";
import { getI18n } from "@/lib/i18n/server";
import { normalizeDigits } from "@/lib/format";
import { stayHourWrite } from "@/lib/clock";
import { CANCEL_POLICIES } from "@/lib/policies";
import { stayHourField } from "@/lib/validation";
import { getSettings } from "@/lib/settings";
import { PAYMENT_MODES_FIELD, serializeListingPaymentModes } from "@/lib/payments";
import type { Dictionary } from "@/lib/i18n";

/**
 * Listing CRUD.
 *
 * Two entry points, one implementation:
 *   • the admin actions operate on any listing
 *   • the `…OwnerListing` actions are scoped to the signed-in owner's own rows
 *
 * Every action begins with a guard. Server actions are reachable by anyone who
 * can guess their generated id — the middleware guard on /admin and /owner
 * protects *navigation*, not the action endpoints, so authorisation has to be
 * re-asserted here.
 *
 * The owner-scoped actions put `ownerId` in the **WHERE clause** rather than
 * checking ownership after reading. An owner asking for someone else's listing
 * gets "not found" — the same answer as for an id that doesn't exist, which is
 * both the correct authorisation outcome and the one that leaks nothing about
 * which other rows exist (IDOR).
 *
 * After a write we `revalidatePath` the public pages that embed the data, since
 * listing pages are cached. Without this an owner would edit a price and not see
 * it on the live site.
 */

export type ActionResult =
  | { ok: true; id?: string; slug?: string; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const VALID_CITY_IDS = CITIES.map((c) => c.id);
const VALID_AMENITY_IDS = new Set(AMENITIES.map((a) => a.id));
const VALID_CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

/**
 * An optional free-text column: trimmed, capped, and blank stored as null.
 *
 * Used for the `*En` fields, where "" and NULL would both mean "fall back to
 * Arabic". Collapsing them keeps one representation in the database instead of
 * two that behave alike but read differently.
 */
function blankToNull(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));
}

function listingSchema(t: Dictionary) {
  return z.object({
    name: z.string().trim().min(3, t.validation.nameTooShort).max(160),
    description: z.string().trim().max(5000).default(""),
    city: z.enum(VALID_CITY_IDS as [string, ...string[]], {
      message: t.validation.invalidCity,
    }),
    area: z.string().trim().max(160).default(""),
    /**
     * English versions of the three free-text fields.
     *
     * No minimum length, unlike `name`: leaving one blank is the documented way
     * to say "show the Arabic to English readers too", so a 2-character English
     * name being rejected while an empty one is accepted would be nonsense.
     * Normalised to null when blank rather than stored as "" — `localized()`
     * treats both the same, but null is what the column means and it keeps
     * "never translated" distinguishable in the data.
     */
    nameEn: blankToNull(160),
    descriptionEn: blankToNull(5000),
    areaEn: blankToNull(160),
    pricePerNight: z.coerce
      .number()
      .int()
      .min(1, t.validation.priceRequired)
      .max(1_000_000),
    weekendPrice: z.coerce.number().int().min(0).max(1_000_000).default(0),
    // Occasion rate. 0 = not offered, exactly like weekendPrice above.
    holidayPrice: z.coerce.number().int().min(0).max(1_000_000).default(0),
    /**
     * Which days that weekend rate covers — "short" (Sat+Sun, the UAE weekend)
     * or "long" (Fri+Sat+Sun, Sharjah's).
     *
     * `.catch()` rather than a bare enum: this is a `<select>` with two fixed
     * options, so anything else is a crafted post or a stale tab, and neither
     * deserves to fail the whole save of an otherwise valid listing. It falls
     * back to the same default the column has. See `toWeekendMode()` in
     * src/lib/dates.ts, which does the same thing on the read side.
     */
    weekendMode: z.enum(WEEKEND_MODES).catch(DEFAULT_WEEKEND_MODE),
    /**
     * The rest house's own arrival, departure and free-cancellation policy.
     *
     * The two hours come from a menu now and are null when the owner left the
     * "use the platform's time" option selected — see `stayHourField` in
     * src/lib/validation.ts for why null rather than 0, given that 0 is
     * midnight. The `*Time` / `*TimeEn` columns beside them are no longer
     * posted by the form; they are carried through from the stored row and
     * retired by `stayHourWrite` the moment an hour is chosen.
     *
     * `freeCancelHours` gets the same `preprocess` treatment for a different
     * reason, the one `depositPercent` documents at the bottom of this schema:
     * `Number("")` is 0, and 0 there means "no free cancellation at all".
     * Without it, every owner who left the box empty would be published as
     * refusing free cancellation.
     */
    checkInHour: stayHourField(),
    checkOutHour: stayHourField(),
    /**
     * The cancellation answer, from a list of six.
     *
     * `.catch("")` rather than a bare enum, matching `weekendMode` above: a
     * value outside the list is a crafted post or a stale tab, and neither
     * deserves to fail the save of an otherwise valid listing. "" is the safe
     * landing because it means "inherit", which is what the listing already
     * did — unlike, say, defaulting to NONE, which would publish a refusal.
     */
    cancelPolicy: z.enum(["", ...CANCEL_POLICIES]).catch(""),
    checkInTime: z.string().trim().max(40).default(""),
    checkInTimeEn: blankToNull(40),
    checkOutTime: z.string().trim().max(40).default(""),
    checkOutTimeEn: blankToNull(40),
    freeCancelHours: z.preprocess(
      (v) => {
        if (v === null || v === undefined) return null;
        const s = normalizeDigits(String(v)).trim();
        if (s === "") return null;
        const n = Number(s);
        return Number.isNaN(n) ? s : n;
      },
      z
        .number({ message: t.validation.freeCancelRange })
        .int(t.validation.freeCancelRange)
        .min(0, t.validation.freeCancelRange)
        .max(720, t.validation.freeCancelRange)
        .nullable(),
    ),
    /**
     * Day-use (no overnight stay) rates and the hour the guest must leave by.
     *
     * `min(0)` and defaulting to 0 rather than being nullable: unlike
     * `depositPercent` there is no "inherit a platform figure" case here, so 0
     * carries the single meaning "not offered" and hides the block. A blank
     * field coerces to 0 through `z.coerce`, which is the wanted behaviour and
     * the reason this needs none of the `preprocess` gymnastics below.
     */
    dayUsePrice: z.coerce.number().int().min(0).max(1_000_000).default(0),
    dayUseWeekendPrice: z.coerce.number().int().min(0).max(1_000_000).default(0),
    /**
     * The leave-by hour. Null means "not offered" here, NOT "inherit" — this
     * one has no platform tier, and `resolveDayUseCheckOut` in
     * src/lib/policies.ts explains why giving it one would advertise a leave-by
     * time on every rest house that does not take day bookings.
     */
    dayUseCheckOutHour: stayHourField(),
    dayUseCheckOutTime: z.string().trim().max(40).default(""),
  // Carried from the stored row, never from the request — see the note on
  // `LegacyStayText.paymentModes`. Nullable: null means "inherit".
  paymentModes: z.string().nullable().default(null),
    dayUseCheckOutTimeEn: blankToNull(40),
    /** Refundable security deposit in whole dirhams. 0 = none asked for. */
    securityDeposit: z.coerce.number().int().min(0).max(1_000_000).default(0),
    /**
     * The rest house's Instagram profile URL.
     *
     * `.url()` matches how the platform's own social links are validated in
     * `settingsSchema` — one rule for "this is a link we will render as an
     * anchor", so an owner cannot store a bare handle here that the detail page
     * would then turn into a link to nowhere. Blank becomes null via the same
     * helper the `*En` fields use: "" and NULL would both mean "no Instagram",
     * and one representation is better than two.
     */
    instagram: z
      .string()
      .trim()
      .url(t.validation.invalidUrl)
      .max(300)
      .or(z.literal(""))
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
    capacity: z.coerce.number().int().min(1, t.validation.capacityRequired).max(5000),
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    /**
     * Deposit percentage.
     *
     * Nullable, and null is *not* the same as 0 — see `resolveDepositPercent`
     * in src/lib/pricing.ts. An empty field means "use the platform default";
     * an explicit 0 means "no deposit required". The `preprocess` maps blank
     * input to null before coercion, because `Number("")` is 0 and would
     * otherwise silently turn "I left it blank" into "I require no deposit".
     * Arabic-Indic digits are normalised first, so an owner typing ٢٥ on an
     * Arabic keyboard is understood rather than rejected.
     */
    depositPercent: z.preprocess(
      (v) => {
        if (v === null || v === undefined) return null;
        const s = normalizeDigits(String(v)).trim();
        if (s === "") return null;
        const n = Number(s);
        return Number.isNaN(n) ? s : n;
      },
      z
        .number({ message: t.validation.depositRange })
        .int(t.validation.depositRange)
        .min(DEPOSIT_PERCENT_MIN, t.validation.depositRange)
        .max(DEPOSIT_PERCENT_MAX, t.validation.depositRange)
        .nullable(),
    ),
    ownerName: z.string().trim().max(120).default(""),
    ownerWhatsapp: z.string().trim().max(40).default(""),
    verified: z.coerce.boolean().default(false),
    featured: z.coerce.boolean().default(false),
    published: z.coerce.boolean().default(true),
  });
}

type ListingInput = z.infer<ReturnType<typeof listingSchema>>;

/**
 * The stay-time free text a listing already has, as `readListingForm` needs it.
 *
 * Empty for a listing being created — a new one has no legacy text to preserve.
 */
export type LegacyStayText = {
  /** The pre-list cancellation window. null = inherit, 0 = none allowed. */
  freeCancelHours: number | null;
  checkInTime: string;
  checkInTimeEn: string | null;
  checkOutTime: string;
  checkOutTimeEn: string | null;
  dayUseCheckOutTime: string;
  dayUseCheckOutTimeEn: string | null;
  /**
   * The stored payment modes — carried for exactly the same reason as the stay
   * text above it, and it is the same trap.
   *
   * The editor renders no payment-mode control at all while the platform offers
   * only one mode, which is every deployment today. An unrendered checkbox
   * group posts nothing, and so does one where the owner unticked every box —
   * `FormData` cannot tell those apart. Serialising "nothing was posted" would
   * therefore write `"[]"` ("this owner takes nothing online") onto every
   * listing anyone edits, destroying the null that means "inherit" and quietly
   * excluding those listings from online payment on the day a gateway is
   * connected.
   *
   * So the form posts a hidden marker whenever it renders the control, and when
   * that marker is absent this value is written straight back — the column is
   * not touched. Same shape as `freeCancelHours` above.
   */
  paymentModes: string | null;
};

const NO_LEGACY_STAY_TEXT: LegacyStayText = {
  freeCancelHours: null,
  checkInTime: "",
  checkInTimeEn: null,
  checkOutTime: "",
  checkOutTimeEn: null,
  dayUseCheckOutTime: "",
  dayUseCheckOutTimeEn: null,
  // null — "inherit the platform's list" — which is what a listing that does
  // not exist yet should be created with.
  paymentModes: null,
};

/**
 * The legacy stay text on an existing listing, or the empty set for a new one.
 *
 * A missing row also returns the empty set rather than throwing: the save paths
 * below already report "listing not found" properly a few lines later, and
 * failing here would turn that into an unhandled error.
 */
async function legacyStayTextFor(
  id: string | null,
  /**
   * Scopes the read to one owner's listings, mirroring the WHERE clause the
   * owner save path already writes through. Without it an owner could name
   * somebody else's listing id and have that row's text read on their behalf —
   * the write would still be refused, but a read scoped differently from its
   * write is the shape these bugs arrive in.
   */
  ownerId?: string,
): Promise<LegacyStayText> {
  if (!id) return NO_LEGACY_STAY_TEXT;
  const row = await prisma.listing.findFirst({
    where: ownerId ? { id, ownerId } : { id },
    select: {
      freeCancelHours: true,
      checkInTime: true,
      checkInTimeEn: true,
      checkOutTime: true,
      checkOutTimeEn: true,
      dayUseCheckOutTime: true,
      dayUseCheckOutTimeEn: true,
      paymentModes: true,
    },
  });
  return row ?? NO_LEGACY_STAY_TEXT;
}

/**
 * Read the shared listing fields out of a FormData.
 *
 * `legacy` comes from the stored row, never from the request. The editor no
 * longer renders the six free-text stay-time boxes, so a form that posted them
 * would be posting nothing — and defaulting them to "" would wipe the answer an
 * un-migrated listing still depends on. Threading the stored values in keeps
 * them server-side, where a hidden input would have handed them to the browser
 * to give back.
 */
function readListingForm(
  formData: FormData,
  t: Dictionary,
  legacy: LegacyStayText = NO_LEGACY_STAY_TEXT,
) {
  // Checkboxes are absent from FormData when unchecked, hence the `=== "on"`
  // rather than a truthiness check on a possibly-null value.
  return listingSchema(t).safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    city: formData.get("city"),
    area: formData.get("area") ?? "",
    nameEn: formData.get("nameEn") ?? "",
    descriptionEn: formData.get("descriptionEn") ?? "",
    areaEn: formData.get("areaEn") ?? "",
    pricePerNight: formData.get("pricePerNight"),
    weekendPrice: formData.get("weekendPrice") ?? 0,
    holidayPrice: formData.get("holidayPrice") ?? 0,
    weekendMode: formData.get("weekendMode") ?? DEFAULT_WEEKEND_MODE,
    checkInHour: formData.get("checkInHour"),
    checkOutHour: formData.get("checkOutHour"),
    checkInTime: legacy.checkInTime,
    checkInTimeEn: legacy.checkInTimeEn ?? "",
    checkOutTime: legacy.checkOutTime,
    checkOutTimeEn: legacy.checkOutTimeEn ?? "",
    cancelPolicy: formData.get("cancelPolicy") ?? "",
    // No longer posted by the form — the list replaced the number box. Carried
    // through from the stored row so it survives as the middle tier for a
    // listing nobody has converted yet.
    freeCancelHours: legacy.freeCancelHours,
    dayUsePrice: formData.get("dayUsePrice") ?? 0,
    dayUseWeekendPrice: formData.get("dayUseWeekendPrice") ?? 0,
    dayUseCheckOutHour: formData.get("dayUseCheckOutHour"),
    dayUseCheckOutTime: legacy.dayUseCheckOutTime,
    dayUseCheckOutTimeEn: legacy.dayUseCheckOutTimeEn ?? "",
    // Not posted by the form when the editor renders no control for it — see
    // `readPaymentModes`. Carried through from the stored row so a save cannot
    // silently overwrite an owner's choice with "none".
    paymentModes: legacy.paymentModes,
    securityDeposit: formData.get("securityDeposit") ?? 0,
    instagram: formData.get("instagram") ?? "",
    capacity: formData.get("capacity"),
    lat: formData.get("lat") || 24.7614,
    lng: formData.get("lng") || 55.334,
    depositPercent: formData.get("depositPercent"),
    ownerName: formData.get("ownerName") ?? "",
    ownerWhatsapp: formData.get("ownerWhatsapp") ?? "",
    verified: formData.get("verified") === "on",
    featured: formData.get("featured") === "on",
    published: formData.get("published") === "on",
  });
}

/**
 * The payment modes ticked on the form, serialised for storage.
 *
 * ─── The absent-control case comes first, and it is the whole point ─────────
 * `PAYMENT_MODES_FIELD` is a hidden input the editor renders beside the
 * checkbox group. Its presence is the only way this function can tell "the
 * owner unticked everything" (a real choice, stored as `"[]"`) from "the editor
 * drew no control because the platform offers a single mode" (not a choice at
 * all — every deployment today). Unchecked checkboxes post nothing in both
 * cases, so `getAll` returns `[]` either way.
 *
 * Without the marker, every listing anybody edited would be written as `"[]"`,
 * and on the day a gateway was switched on those listings — and only those —
 * would refuse online payment while untouched ones offered it. Silent, and
 * impossible to explain from the UI.
 *
 * ─── Otherwise ─────────────────────────────────────────────────────────────
 * The ticks are filtered against what the platform actually offers, so a
 * hand-crafted POST naming "ONLINE" on a site with no gateway stores nothing of
 * the sort. And ticking everything currently on offer stores null — inherit —
 * so an owner who accepts the defaults does not freeze today's platform list
 * onto their listing and miss a gateway connected next month.
 */
async function readPaymentModes(
  formData: FormData,
  stored: string | null,
): Promise<string | null> {
  if (!formData.has(PAYMENT_MODES_FIELD)) return stored;

  const settings = await getSettings();
  return serializeListingPaymentModes(formData.getAll("paymentModes").map(String), settings);
}

/** Amenity/category ids arrive as repeated form fields; keep only known ids. */
function readIdList(formData: FormData, field: string, allowed: Set<string>): string[] {
  return formData
    .getAll(field)
    .map(String)
    .filter((id) => allowed.has(id));
}

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * Weekend rates that are *below* the weekday rate they uplift.
 *
 * Almost always a typo — someone swapped the two boxes — and it would publish a
 * Friday price cheaper than a Tuesday one. 0 stays legal in both pairs and keeps
 * its own meaning: "same as the weekday rate" for `weekendPrice`, "day-use not
 * offered" for `dayUseWeekendPrice`.
 *
 * Shared by the admin and owner paths so the two cannot drift into enforcing
 * different rules on the same columns.
 */
function weekendRateProblem(data: ListingInput, t: Dictionary): ActionResult | null {
  if (data.weekendPrice > 0 && data.weekendPrice < data.pricePerNight) {
    return {
      ok: false,
      error: t.validation.weekendBelowWeekday,
      fieldErrors: { weekendPrice: t.validation.weekendBelowWeekdayShort },
    };
  }

  // The occasion rate is the top of the same ladder, so the same typo is
  // possible and costs more: it outranks the weekend rate in `nightRate`, so an
  // occasion price below the weekday one would make Eid the cheapest night of
  // the year. Compared against the weekday rate — the floor of the ladder —
  // rather than the weekend rate, because a listing may legitimately leave
  // `weekendPrice` at 0.
  if (data.holidayPrice > 0 && data.holidayPrice < data.pricePerNight) {
    return {
      ok: false,
      error: t.validation.holidayBelowWeekday,
      fieldErrors: { holidayPrice: t.validation.holidayBelowWeekdayShort },
    };
  }

  if (
    data.dayUseWeekendPrice > 0 &&
    data.dayUsePrice > 0 &&
    data.dayUseWeekendPrice < data.dayUsePrice
  ) {
    return {
      ok: false,
      error: t.validation.weekendBelowWeekday,
      fieldErrors: { dayUseWeekendPrice: t.validation.weekendBelowWeekdayShort },
    };
  }

  return null;
}

/** Revalidate everything a listing change can appear on. */
function revalidateListing(slug?: string) {
  revalidatePath("/");
  revalidatePath("/listings");
  revalidatePath("/favorites");
  if (slug) revalidatePath(`/listings/${slug}`);
}

/** Turn a guard failure into a translated result rather than a 500. */
function guardResult(error: unknown, t: Dictionary): ActionResult {
  if (error instanceof AuthorizationError) {
    return {
      ok: false,
      error:
        error.code === "OWNER_INACTIVE"
          ? t.validation.ownerInactive
          : t.validation.unauthorized,
    };
  }
  throw error;
}

/**
 * The columns a listing write may set, built explicitly from validated input.
 *
 * Named field by field rather than spread from the parsed object: `ownerId`,
 * `rating`, `reviewsCount` and `bookingsCount` must never be settable from a
 * form, and an allow-list a reader can see in full is what stops a field added
 * later from becoming a mass-assignment hole by default.
 */
function listingColumns(
  data: ListingInput,
  amenities: string[],
  categories: string[],
  /**
   * The owner's payment-mode choice, already serialised — null means "inherit
   * the platform's list".
   *
   * Passed in rather than read from `data` because serialising it needs the
   * platform's current list, which needs `getSettings()`, which is async — and
   * this function is not. Computing it in the caller keeps this one a pure
   * mapping from parsed form to columns, which is what makes the allow-list
   * below readable in a single pass.
   */
  paymentModes: string | null,
  opts: { allowEditorialFlags: boolean },
) {
  // The three stay times. The form posts only an hour for each; the legacy free
  // text arrives on `data` from the stored row (see `readListingForm`), and
  // `stayHourWrite` decides which of the two survives — the text is retired the
  // moment an hour is chosen, and kept untouched while none is.
  const checkIn = stayHourWrite(data.checkInHour, {
    arabic: data.checkInTime,
    english: data.checkInTimeEn,
  });
  const checkOut = stayHourWrite(data.checkOutHour, {
    arabic: data.checkOutTime,
    english: data.checkOutTimeEn,
  });
  const dayUseCheckOut = stayHourWrite(data.dayUseCheckOutHour, {
    arabic: data.dayUseCheckOutTime,
    english: data.dayUseCheckOutTimeEn,
  });

  const common = {
    name: data.name,
    description: data.description,
    city: data.city,
    area: data.area,
    // Owner-writable in both dashboards: translating your own listing is not an
    // editorial privilege, and an owner is the only person who knows what their
    // rest house should be called in English.
    nameEn: data.nameEn,
    descriptionEn: data.descriptionEn,
    areaEn: data.areaEn,
    pricePerNight: data.pricePerNight,
    weekendPrice: data.weekendPrice,
    holidayPrice: data.holidayPrice,
    // Which days that weekend rate covers, and the rest house's own arrival,
    // departure and free-cancellation policy. All in `common`: an owner in
    // Sharjah is the only person who knows their weekend is three days long,
    // and the hour they hand over the keys is theirs to state. Everything here
    // is recomputed server-side at booking time (`createBookingRequest` re-reads
    // `weekendMode` from the row), so nothing the browser posts is trusted for
    // money either way.
    weekendMode: data.weekendMode,
    checkInHour: checkIn.hour,
    checkInTime: checkIn.arabic,
    checkInTimeEn: checkIn.english,
    checkOutHour: checkOut.hour,
    checkOutTime: checkOut.arabic,
    checkOutTimeEn: checkOut.english,
    cancelPolicy: data.cancelPolicy,
    freeCancelHours: data.freeCancelHours,
    // Day-use rates, the leave-by time and the refundable security deposit are
    // commercial terms of the rest house, exactly like the nightly price — so
    // they sit in `common` and an owner sets their own. Nothing editorial about
    // them, and they are display-only, so there is no money path to protect.
    dayUsePrice: data.dayUsePrice,
    dayUseWeekendPrice: data.dayUseWeekendPrice,
    dayUseCheckOutHour: dayUseCheckOut.hour,
    dayUseCheckOutTime: dayUseCheckOut.arabic,
    dayUseCheckOutTimeEn: dayUseCheckOut.english,
    securityDeposit: data.securityDeposit,
    // The rest house's own Instagram, in `common` alongside the other contact
    // details for the same reason: it is the owner's account, not an editorial
    // decision, so an owner sets it on their own listing.
    instagram: data.instagram,
    capacity: data.capacity,
    lat: data.lat,
    lng: data.lng,
    depositPercent: data.depositPercent,
    // In `common`, so an owner sets it on their own listing: whether a rest
    // house takes card payments is a commercial term of the venue, exactly like
    // its nightly rate, not an editorial decision. It can only ever NARROW the
    // platform's list — `serializeListingPaymentModes` intersects before
    // storing — so an owner cannot switch on a gateway the platform has not
    // connected.
    paymentModes,
    amenities: stringifyIdList(amenities),
    categories: stringifyIdList(categories),
    published: data.published,
  };

  // `verified` and `featured` are editorial badges the *platform* grants. An
  // owner marking their own listing "verified" would defeat the point of the
  // badge, and self-featuring would let owners promote themselves onto the home
  // page. Only the admin path may set them — and only the admin path may write
  // the legacy per-listing contact fields, which for an owned listing are not
  // the source of truth anyway (see resolveListingWhatsapp).
  if (!opts.allowEditorialFlags) return common;

  return {
    ...common,
    verified: data.verified,
    featured: data.featured,
    ownerName: data.ownerName || "المالك",
    ownerWhatsapp: data.ownerWhatsapp || null,
  };
}

/* -------------------------------------------------------------------------- */
/* create / update — admin                                                    */
/* -------------------------------------------------------------------------- */

export async function saveListing(formData: FormData): Promise<ActionResult> {
  const { t } = await getI18n();

  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return guardResult(error, t);
  }

  const id = String(formData.get("id") ?? "").trim() || null;
  const parsed = readListingForm(formData, t, await legacyStayTextFor(id));

  if (!parsed.success) {
    return {
      ok: false,
      error: t.validation.checkFields,
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const data = parsed.data;
  const amenities = readIdList(formData, "amenities", VALID_AMENITY_IDS);
  const categories = readIdList(formData, "categories", VALID_CATEGORY_IDS);

  const ratesProblem = weekendRateProblem(data, t);
  if (ratesProblem) return ratesProblem;

  const common = listingColumns(
    data,
    amenities,
    categories,
    await readPaymentModes(formData, data.paymentModes),
    { allowEditorialFlags: true },
  );

  // An admin may assign a listing to an owner. Only ids that actually exist are
  // accepted — a bad id silently becoming null would quietly turn an owned
  // listing into a platform-owned one that ignores the owner's membership.
  let ownerId: string | null | undefined;
  if (formData.has("ownerId")) {
    const rawOwnerId = String(formData.get("ownerId") ?? "").trim();
    if (!rawOwnerId) {
      ownerId = null;
    } else {
      const owner = await prisma.ownerProfile.findUnique({
        where: { id: rawOwnerId },
        select: { id: true },
      });
      if (!owner) return { ok: false, error: t.validation.ownerNotFound };
      ownerId = owner.id;
    }
  }

  try {
    if (id) {
      const existing = await prisma.listing.findUnique({
        where: { id },
        select: { slug: true, name: true, published: true },
      });
      if (!existing) return { ok: false, error: t.validation.listingNotFound };

      // Only re-slug on a rename, so existing links and search rankings survive
      // an ordinary price or description edit.
      const slug =
        existing.name === data.name
          ? existing.slug
          : uniqueSlug(data.name, await getTakenSlugs(id));

      const updated = await prisma.listing.update({
        where: { id },
        data: { ...common, slug, ...(ownerId !== undefined ? { ownerId } : {}) },
      });

      await prisma.auditLog.create({
        data: auditData({
          actor: { id: admin.id, email: admin.email, role: admin.role },
          action:
            existing.published !== data.published
              ? "LISTING_VISIBILITY_CHANGED"
              : "LISTING_UPDATED",
          entityType: "Listing",
          entityId: updated.id,
          summary: updated.name,
          metadata: {
            publishedFrom: existing.published,
            publishedTo: data.published,
            depositPercent: data.depositPercent,
          },
        }),
      });

      revalidateListing(existing.slug);
      if (slug !== existing.slug) revalidateListing(slug);
      revalidatePath("/admin/listings");

      return { ok: true, id: updated.id, slug: updated.slug, message: t.common.saved };
    }

    const slug = uniqueSlug(data.name, await getTakenSlugs());
    const created = await prisma.listing.create({
      data: { ...common, slug, ...(ownerId !== undefined ? { ownerId } : {}) },
    });

    await prisma.auditLog.create({
      data: auditData({
        actor: { id: admin.id, email: admin.email, role: admin.role },
        action: "LISTING_CREATED",
        entityType: "Listing",
        entityId: created.id,
        summary: created.name,
        metadata: { ownerId: ownerId ?? null },
      }),
    });

    revalidateListing(slug);
    revalidatePath("/admin/listings");

    return { ok: true, id: created.id, slug: created.slug, message: t.common.created };
  } catch (error) {
    console.error("saveListing failed:", error);
    return { ok: false, error: t.validation.saveFailed };
  }
}

/* -------------------------------------------------------------------------- */
/* create / update — owner                                                    */
/* -------------------------------------------------------------------------- */

/**
 * An owner creating or editing one of their own listings.
 *
 * `requireApprovedOwner()` re-reads status and membership from the database, so
 * a pending, rejected, suspended or expired owner is refused here even though
 * their 30-day session cookie is still perfectly valid. Hiding the form is a UX
 * courtesy; this is the enforcement.
 */
export async function saveOwnerListing(formData: FormData): Promise<ActionResult> {
  const { t } = await getI18n();

  let owner, user;
  try {
    ({ owner, user } = await requireApprovedOwner());
  } catch (error) {
    return guardResult(error, t);
  }

  const id = String(formData.get("id") ?? "").trim() || null;
  const parsed = readListingForm(formData, t, await legacyStayTextFor(id, owner.id));

  if (!parsed.success) {
    return {
      ok: false,
      error: t.validation.checkFields,
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const data = parsed.data;
  const amenities = readIdList(formData, "amenities", VALID_AMENITY_IDS);
  const categories = readIdList(formData, "categories", VALID_CATEGORY_IDS);

  const ratesProblem = weekendRateProblem(data, t);
  if (ratesProblem) return ratesProblem;

  const common = listingColumns(
    data,
    amenities,
    categories,
    await readPaymentModes(formData, data.paymentModes),
    { allowEditorialFlags: false },
  );

  try {
    if (id) {
      // `ownerId` in the WHERE clause, not a check after the read.
      const existing = await prisma.listing.findFirst({
        where: { id, ownerId: owner.id },
        select: { id: true, slug: true, name: true, published: true },
      });
      if (!existing) return { ok: false, error: t.validation.listingNotFound };

      const slug =
        existing.name === data.name
          ? existing.slug
          : uniqueSlug(data.name, await getTakenSlugs(id));

      const updated = await prisma.listing.update({
        where: { id: existing.id },
        data: { ...common, slug },
      });

      await prisma.auditLog.create({
        data: auditData({
          actor: { id: user.id, email: user.email, role: user.role },
          action:
            existing.published !== data.published
              ? "LISTING_VISIBILITY_CHANGED"
              : "LISTING_UPDATED",
          entityType: "Listing",
          entityId: updated.id,
          summary: updated.name,
          metadata: {
            ownerId: owner.id,
            publishedFrom: existing.published,
            publishedTo: data.published,
            depositPercent: data.depositPercent,
          },
        }),
      });

      revalidateListing(existing.slug);
      if (slug !== existing.slug) revalidateListing(slug);
      revalidatePath("/owner/listings");

      return { ok: true, id: updated.id, slug: updated.slug, message: t.common.saved };
    }

    const slug = uniqueSlug(data.name, await getTakenSlugs());
    const created = await prisma.listing.create({
      // ownerId comes from the session, never the form.
      data: { ...common, slug, ownerId: owner.id },
    });

    await prisma.auditLog.create({
      data: auditData({
        actor: { id: user.id, email: user.email, role: user.role },
        action: "LISTING_CREATED",
        entityType: "Listing",
        entityId: created.id,
        summary: created.name,
        metadata: { ownerId: owner.id },
      }),
    });

    revalidateListing(slug);
    revalidatePath("/owner/listings");

    return { ok: true, id: created.id, slug: created.slug, message: t.common.created };
  } catch (error) {
    console.error("saveOwnerListing failed:", error);
    return { ok: false, error: t.validation.saveFailed };
  }
}

/* -------------------------------------------------------------------------- */
/* delete                                                                     */
/* -------------------------------------------------------------------------- */

export async function deleteListing(id: string): Promise<ActionResult> {
  const { t } = await getI18n();

  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return guardResult(error, t);
  }

  return deleteListingScoped({ id }, t, {
    id: admin.id,
    email: admin.email,
    role: admin.role,
  });
}

/** An owner deleting one of their own listings. */
export async function deleteOwnerListing(id: string): Promise<ActionResult> {
  const { t } = await getI18n();

  let owner, user;
  try {
    ({ owner, user } = await requireApprovedOwner());
  } catch (error) {
    return guardResult(error, t);
  }

  return deleteListingScoped({ id, ownerId: owner.id }, t, {
    id: user.id,
    email: user.email,
    role: user.role,
  });
}

async function deleteListingScoped(
  where: Prisma.ListingWhereInput,
  t: Dictionary,
  actor: { id: string; email: string; role: string },
): Promise<ActionResult> {
  try {
    const listing = await prisma.listing.findFirst({
      where,
      select: { id: true, name: true, slug: true, images: { select: { url: true } } },
    });
    if (!listing) return { ok: false, error: t.validation.listingNotFound };

    // Image rows cascade at the database level (onDelete: Cascade), but the
    // stored *bytes* don't — a file on disk or a StoredImage blob outlives the
    // row that referenced it. Clean them up first so deleting a listing doesn't
    // leak orphaned uploads. `deleteStoredAsset` routes on the URL's shape, so a
    // gallery mixing local files, database blobs and seed URLs is handled
    // correctly in one pass.
    await Promise.all(listing.images.map((img) => deleteStoredAsset(img.url)));

    await prisma.$transaction([
      prisma.listing.delete({ where: { id: listing.id } }),
      prisma.auditLog.create({
        data: auditData({
          actor,
          action: "LISTING_DELETED",
          entityType: "Listing",
          entityId: listing.id,
          summary: listing.name,
        }),
      }),
    ]);

    revalidateListing(listing.slug);
    revalidatePath("/admin/listings");
    revalidatePath("/owner/listings");

    return { ok: true, message: t.common.deleted };
  } catch (error) {
    console.error("deleteListing failed:", error);
    return { ok: false, error: t.validation.deleteFailed };
  }
}

/* -------------------------------------------------------------------------- */
/* publish toggle                                                             */
/* -------------------------------------------------------------------------- */

/** Quick publish/unpublish from the listings grid. */
export async function toggleListingPublished(id: string): Promise<ActionResult> {
  const { t } = await getI18n();

  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return guardResult(error, t);
  }

  return togglePublishedScoped({ id }, t, {
    id: admin.id,
    email: admin.email,
    role: admin.role,
  });
}

export async function toggleOwnerListingPublished(id: string): Promise<ActionResult> {
  const { t } = await getI18n();

  let owner, user;
  try {
    ({ owner, user } = await requireApprovedOwner());
  } catch (error) {
    return guardResult(error, t);
  }

  return togglePublishedScoped({ id, ownerId: owner.id }, t, {
    id: user.id,
    email: user.email,
    role: user.role,
  });
}

async function togglePublishedScoped(
  where: Prisma.ListingWhereInput,
  t: Dictionary,
  actor: { id: string; email: string; role: string },
): Promise<ActionResult> {
  const listing = await prisma.listing.findFirst({
    where,
    select: { id: true, name: true, published: true, slug: true },
  });
  if (!listing) return { ok: false, error: t.validation.listingNotFound };

  await prisma.$transaction([
    prisma.listing.update({
      where: { id: listing.id },
      data: { published: !listing.published },
    }),
    prisma.auditLog.create({
      data: auditData({
        actor,
        action: "LISTING_VISIBILITY_CHANGED",
        entityType: "Listing",
        entityId: listing.id,
        summary: listing.name,
        metadata: { publishedFrom: listing.published, publishedTo: !listing.published },
      }),
    }),
  ]);

  revalidateListing(listing.slug);
  revalidatePath("/admin/listings");
  revalidatePath("/owner/listings");

  return { ok: true, message: t.common.saved };
}

/* -------------------------------------------------------------------------- */
/* images                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Attach uploaded images to a listing.
 *
 * Bytes go through the storage adapter (src/lib/storage), so this same action
 * works unchanged whether files land on local disk, Cloudinary or S3.
 */
export async function addListingImages(
  listingId: string,
  files: File[],
): Promise<ActionResult> {
  const { t } = await getI18n();

  try {
    await requireAdmin();
  } catch (error) {
    return guardResult(error, t);
  }

  return addImagesScoped({ id: listingId }, files, t);
}

export async function addOwnerListingImages(
  listingId: string,
  files: File[],
): Promise<ActionResult> {
  const { t } = await getI18n();

  let owner;
  try {
    ({ owner } = await requireApprovedOwner());
  } catch (error) {
    return guardResult(error, t);
  }

  return addImagesScoped({ id: listingId, ownerId: owner.id }, files, t);
}

/** Maximum gallery size per listing. */
const MAX_IMAGES = 30;

async function addImagesScoped(
  where: Prisma.ListingWhereInput,
  files: File[],
  t: Dictionary,
): Promise<ActionResult> {
  const listing = await prisma.listing.findFirst({
    where,
    select: { id: true, slug: true, name: true, _count: { select: { images: true } } },
  });
  if (!listing) return { ok: false, error: t.validation.listingNotFound };

  if (listing._count.images + files.length > MAX_IMAGES) {
    return { ok: false, error: t.listing.tooManyImages(String(MAX_IMAGES)) };
  }

  const storage = getStorage();
  let sortOrder = listing._count.images;

  try {
    for (const file of files) {
      if (!file || file.size === 0) continue;
      const stored = await storage.save(file, { folder: "listings" });
      await prisma.listingImage.create({
        data: {
          listingId: listing.id,
          url: stored.url,
          alt: `${listing.name} — ${sortOrder + 1}`,
          sortOrder: sortOrder++,
        },
      });
    }
  } catch (error) {
    // The adapter refused the file. It carries a stable `code` rather than a
    // translated string, because the storage layer is provider-agnostic
    // plumbing with no request scope — so the message is resolved here, where
    // the visitor's locale is known.
    if (error instanceof UploadError) {
      const byCode: Record<string, string> = {
        NO_FILE: t.validation.uploadNoFile,
        EMPTY: t.validation.uploadEmpty,
        TOO_LARGE: t.validation.uploadTooLarge,
        BAD_FORMAT: t.validation.uploadBadFormat,
      };
      return { ok: false, error: byCode[error.code] ?? t.validation.saveFailed };
    }
    console.error("addListingImages failed:", error);
    return { ok: false, error: t.validation.saveFailed };
  }

  revalidateListing(listing.slug);
  revalidatePath(`/admin/listings/${listing.id}`);
  revalidatePath(`/owner/listings/${listing.id}`);

  return { ok: true, message: t.common.saved };
}

export async function deleteListingImage(imageId: string): Promise<ActionResult> {
  const { t } = await getI18n();

  try {
    await requireAdmin();
  } catch (error) {
    return guardResult(error, t);
  }

  return deleteImageScoped(imageId, undefined, t);
}

export async function deleteOwnerListingImage(imageId: string): Promise<ActionResult> {
  const { t } = await getI18n();

  let owner;
  try {
    ({ owner } = await requireApprovedOwner());
  } catch (error) {
    return guardResult(error, t);
  }

  return deleteImageScoped(imageId, owner.id, t);
}

async function deleteImageScoped(
  imageId: string,
  ownerId: string | undefined,
  t: Dictionary,
): Promise<ActionResult> {
  const image = await prisma.listingImage.findFirst({
    // The ownership constraint is expressed through the parent listing, so an
    // owner passing another owner's image id gets "not found".
    where: { id: imageId, ...(ownerId ? { listing: { ownerId } } : {}) },
    select: { id: true, url: true, listingId: true, listing: { select: { slug: true } } },
  });
  if (!image) return { ok: false, error: t.validation.listingNotFound };

  await prisma.listingImage.delete({ where: { id: image.id } });
  await deleteStoredAsset(image.url);

  revalidateListing(image.listing.slug);
  revalidatePath(`/admin/listings/${image.listingId}`);
  revalidatePath(`/owner/listings/${image.listingId}`);

  return { ok: true, message: t.common.deleted };
}

/** Move an image to the front of the gallery — it becomes the card cover. */
export async function makeImageCover(imageId: string): Promise<ActionResult> {
  const { t } = await getI18n();

  try {
    await requireAdmin();
  } catch (error) {
    return guardResult(error, t);
  }

  return makeCoverScoped(imageId, undefined, t);
}

export async function makeOwnerImageCover(imageId: string): Promise<ActionResult> {
  const { t } = await getI18n();

  let owner;
  try {
    ({ owner } = await requireApprovedOwner());
  } catch (error) {
    return guardResult(error, t);
  }

  return makeCoverScoped(imageId, owner.id, t);
}

async function makeCoverScoped(
  imageId: string,
  ownerId: string | undefined,
  t: Dictionary,
): Promise<ActionResult> {
  const image = await prisma.listingImage.findFirst({
    where: { id: imageId, ...(ownerId ? { listing: { ownerId } } : {}) },
    select: { id: true, listingId: true, listing: { select: { slug: true } } },
  });
  if (!image) return { ok: false, error: t.validation.listingNotFound };

  const siblings = await prisma.listingImage.findMany({
    where: { listingId: image.listingId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });

  // Rewrite the whole order rather than juggling two rows — with ≤30 images it
  // costs nothing and can't leave a duplicate sortOrder behind.
  const reordered = [
    image.id,
    ...siblings.map((s) => s.id).filter((sid) => sid !== image.id),
  ];
  await prisma.$transaction(
    reordered.map((sid, index) =>
      prisma.listingImage.update({ where: { id: sid }, data: { sortOrder: index } }),
    ),
  );

  revalidateListing(image.listing.slug);
  revalidatePath(`/admin/listings/${image.listingId}`);
  revalidatePath(`/owner/listings/${image.listingId}`);

  return { ok: true, message: t.common.saved };
}
