"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { SETTINGS_ID } from "@/lib/settings";
import { stayHourWrite } from "@/lib/clock";
import {
  ALLOWED_LOGO_TYPES,
  assertValidImage,
  deleteStoredAsset,
  getStorage,
  looksLikeSvg,
  prepareLogo,
  SVG_TYPE,
  UploadError,
} from "@/lib/storage";
import {
  optionalEmailField,
  optionalPhoneField,
  stayHourField,
  whatsappField,
} from "@/lib/validation";
import type { ActionResult } from "./listings";
import { getI18n } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n";

/**
 * Site settings.
 *
 * This is what makes the whole site rebrandable without touching code: name,
 * colours, WhatsApp number, contacts, socials, map location, fees and SEO text
 * all live in one row that this action writes.
 *
 * Because the root layout injects the colours as CSS variables and reads the
 * name into metadata, `revalidatePath("/", "layout")` is what pushes a change
 * out to every page at once.
 */

function settingsSchema(t: Dictionary) {
  const hex = z
    .string()
    .trim()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, t.validation.invalidColor);

  // ---- Google tag ------------------------------------------------------
  //
  // Identifiers, not code. What the operator pastes is checked against the
  // shape Google actually issues, so a half-copied line or a stray fragment of
  // the <script> tag is refused at the form rather than silently rendered into
  // every page as a tag that never fires.
  //
  // "" is always allowed and is what turns tracking off.
  const googleTagId = z
    .string()
    .trim()
    // Google prints these upper-case; accepting a lower-case paste and
    // normalising it is friendlier than rejecting "aw-950802645" as invalid.
    // Safe because the whole identifier is [A-Z0-9] — unlike the conversion
    // label below, which is case-sensitive and must never be touched.
    .transform((v) => v.toUpperCase())
    // The four prefixes gtag.js itself accepts as a tag ID: Ads, GA4, a Google
    // Tag, and Campaign Manager. Deliberately NOT "GTM-": a Tag Manager
    // container is loaded by gtm.js, not by gtag/js?id=, so accepting one here
    // would render a script that quietly does nothing. The error message names
    // all four and says so, rather than leaving a GTM operator guessing.
    .refine(
      (v) => v === "" || /^(?:AW|G|GT|DC)-[A-Z0-9]+$/.test(v),
      t.validation.invalidGoogleTagId,
    );

  const googleAdsConversionLabel = z
    .string()
    .trim()
    // Google shows the conversion as "AW-950802645/dVoECJ30sOQcENWxsMUD" and an
    // operator will reasonably paste the whole thing. Keep only the half after
    // the slash: the id is already stored in its own field, and holding it
    // twice is how the two drift apart.
    .transform((v) => (v.includes("/") ? v.slice(v.lastIndexOf("/") + 1).trim() : v))
    .refine(
      (v) => v === "" || /^[A-Za-z0-9_-]{4,64}$/.test(v),
      t.validation.invalidConversionLabel,
    );

  return z.object({
  // identity
    siteName: z.string().trim().min(2, t.validation.siteNameRequired).max(80),
  tagline: z.string().trim().max(120).default(""),
  logoGlyph: z.string().trim().min(1).max(2).default("و"),

  // contact — both stored in the canonical plus-less form, so the site's own
  // number is written exactly like every owner's and the footer, the header CTA
  // and the wa.me links all read the same string.
  whatsappNumber: whatsappField(t),
  phone: optionalPhoneField(t),
    email: optionalEmailField(t),

  // socials — full URLs so the footer can link them directly
  instagram: z.string().trim().url(t.validation.invalidUrl).or(z.literal("")).default(""),
  tiktok: z.string().trim().url(t.validation.invalidUrl).or(z.literal("")).default(""),
  snapchat: z.string().trim().url(t.validation.invalidUrl).or(z.literal("")).default(""),
  youtube: z.string().trim().url(t.validation.invalidUrl).or(z.literal("")).default(""),

  // ---- the platform's bank account, and the trade licence ---------------
  //
  // Free text with a length cap and nothing else. Account-number and IBAN
  // formats vary by country, and a regex tuned for a UAE IBAN would lock out an
  // operator who banks elsewhere — a validation rule that refuses correct data
  // is worse than none, because there is no way around it from the form.
  bankName: z.string().trim().max(120).default(""),
  bankAccountHolder: z.string().trim().max(120).default(""),
  bankAccountNumber: z.string().trim().max(64).default(""),
  bankIban: z.string().trim().max(64).default(""),
  tradeLicense: z.string().trim().max(64).default(""),

  // location
  mapLat: z.coerce.number().min(-90).max(90),
  mapLng: z.coerce.number().min(-180).max(180),
  mapZoom: z.coerce.number().int().min(1).max(20).default(10),
  addressLine: z.string().trim().max(200).default(""),

  // theme
  colorAccent: hex,
  colorAccentDeep: hex,
  colorNight: hex,
  colorSand: hex,

  // commercials
  serviceFeePercent: z.coerce.number().int().min(0).max(50),
  depositPercent: z.coerce.number().int().min(0).max(100),
  // The platform's cut, paid by the owner — see `platformCommission()` in
  // src/lib/pricing.ts for why this is not the same field as the service fee.
  commissionPercent: z.coerce.number().int().min(0).max(100),
  // At least one day, or a review link would expire before it was sent.
  reviewInviteDays: z.coerce.number().int().min(1).max(365),
  freeCancelHours: z.coerce.number().int().min(0).max(720),
  /**
   * The platform's fallback arrival and departure hours, 0–23.
   *
   * `min(0)`, not `min(1)` — midnight is a real answer and stores as 0. The
   * *menu* offers the hours in reading order, 1 AM last-to-midnight, but that
   * ordering lives in `STAY_HOURS` (src/lib/clock.ts) and must not leak into
   * the valid range, or midnight becomes unsavable.
   *
   * Nullable through the same `preprocess` shape `Listing.freeCancelHours`
   * uses, and for the same reason: `Number("")` is 0, and 0 here means
   * midnight. Without this, an operator submitting the form with the option
   * left on "keep the current text" would set the platform to midnight.
   */
  checkInHour: stayHourField(),
  checkOutHour: stayHourField(),
  checkInTime: z.string().trim().max(40).default("٤ عصرًا"),
  checkOutTime: z.string().trim().max(40).default("١٢ ظهرًا"),
  // ---- payments ----
  //
  // Switches only. No credential is accepted here and none ever should be: a
  // merchant key on the settings row would be readable by every operator
  // account and would land in the nightly pg_dump. Credentials live in the
  // environment — see src/lib/payments/config.ts.
  //
  // Every one of these defaults to false, so a form posted without the field
  // (an older cached page, a partial submission) switches payments OFF rather
  // than on. That is the safe direction for a checkbox that decides whether
  // money can move.
  depositPaymentsEnabled: z.coerce.boolean().default(false),
  telrEnabled: z.coerce.boolean().default(false),
  tabbyEnabled: z.coerce.boolean().default(false),
  tamaraEnabled: z.coerce.boolean().default(false),
  paymentLinksEnabled: z.coerce.boolean().default(false),
  // A payment link is a bearer credential, so its life is bounded at both ends:
  // at least a day to be usable, at most 90 so nothing sits in a WhatsApp
  // thread indefinitely.
  paymentLinkDays: z.coerce.number().int().min(1).max(90).default(7),

  // home hero + SEO
  heroTitle: z.string().trim().max(120),
  heroTitleAlt: z.string().trim().max(120).default(""),
  heroSubtitle: z.string().trim().max(400).default(""),
  footerAbout: z.string().trim().max(400).default(""),
    seoTitle: z.string().trim().max(120).default(""),
    seoDescription: z.string().trim().max(320).default(""),

    // ---- Google tag ----
    googleTagId,
    googleAdsConversionLabel,

    // ---- English copy ----------------------------------------------------
    // All optional. Blank means "fall back to the Arabic value" — see
    // `localized()` in src/lib/settings.ts. That fallback is what lets an
    // operator who never fills these in still get a working English site.
    siteNameEn: z.string().trim().max(80).default(""),
    taglineEn: z.string().trim().max(120).default(""),
    addressLineEn: z.string().trim().max(200).default(""),
    checkInTimeEn: z.string().trim().max(40).default(""),
    checkOutTimeEn: z.string().trim().max(40).default(""),
    seoTitleEn: z.string().trim().max(120).default(""),
    seoDescriptionEn: z.string().trim().max(320).default(""),
    heroTitleEn: z.string().trim().max(120).default(""),
    heroTitleAltEn: z.string().trim().max(120).default(""),
    heroSubtitleEn: z.string().trim().max(400).default(""),
    footerAboutEn: z.string().trim().max(400).default(""),
  });
}

/**
 * A single coordinate field like "24.7614, 55.3340" is far easier to use on a
 * phone than two number inputs — the owner copies it straight out of Google
 * Maps. Split it here rather than making them separate the parts by hand.
 */
function parseCoordinatePair(raw: string): { lat: number; lng: number } | null {
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  const [lat, lng] = parts;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export async function saveSettings(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const { t } = await getI18n();

  // Accept either the combined "lat, lng" field or the individual ones.
  const coordsRaw = String(formData.get("coordinates") ?? "").trim();
  const coords = coordsRaw ? parseCoordinatePair(coordsRaw) : null;
  if (coordsRaw && !coords) {
    return {
      ok: false,
      error: t.validation.invalidCoordinates,
      fieldErrors: { coordinates: t.validation.invalidFormat },
    };
  }

  // The four stay-time text columns are no longer rendered by the form — an
  // hour is picked from a menu instead. They are still read as the middle tier
  // of the fallback, so they are carried through from the stored row rather
  // than defaulted: reconstructing them from a form that does not post them
  // would silently reset an operator's own wording on the next unrelated save.
  const current = await prisma.siteSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: {
      checkInTime: true,
      checkInTimeEn: true,
      checkOutTime: true,
      checkOutTimeEn: true,
    },
  });

  const parsed = settingsSchema(t).safeParse({
    siteName: formData.get("siteName"),
    tagline: formData.get("tagline") ?? "",
    logoGlyph: formData.get("logoGlyph") || "و",
    whatsappNumber: formData.get("whatsappNumber"),
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    instagram: formData.get("instagram") ?? "",
    tiktok: formData.get("tiktok") ?? "",
    snapchat: formData.get("snapchat") ?? "",
    youtube: formData.get("youtube") ?? "",
    bankName: formData.get("bankName") ?? "",
    bankAccountHolder: formData.get("bankAccountHolder") ?? "",
    bankAccountNumber: formData.get("bankAccountNumber") ?? "",
    bankIban: formData.get("bankIban") ?? "",
    tradeLicense: formData.get("tradeLicense") ?? "",
    mapLat: coords?.lat ?? formData.get("mapLat") ?? 24.7614,
    mapLng: coords?.lng ?? formData.get("mapLng") ?? 55.334,
    mapZoom: formData.get("mapZoom") || 10,
    addressLine: formData.get("addressLine") ?? "",
    colorAccent: formData.get("colorAccent"),
    colorAccentDeep: formData.get("colorAccentDeep"),
    colorNight: formData.get("colorNight"),
    colorSand: formData.get("colorSand"),
    // 0, not 5: this fallback is what a missing field resolves to, so leaving
    // it at the old default would write the fee back on the next settings save.
    serviceFeePercent: formData.get("serviceFeePercent") ?? 0,
    depositPercent: formData.get("depositPercent") ?? 30,
    commissionPercent: formData.get("commissionPercent") ?? 5,
    reviewInviteDays: formData.get("reviewInviteDays") ?? 15,
    freeCancelHours: formData.get("freeCancelHours") ?? 48,
    checkInHour: formData.get("checkInHour"),
    checkOutHour: formData.get("checkOutHour"),
    // The form no longer renders these; the stored text is carried through
    // untouched so a settings save cannot wipe the legacy value an operator is
    // still relying on. `applyStayHours` below clears it, but only for the one
    // of the pair that just gained an hour.
    checkInTime: current?.checkInTime ?? "٤ عصرًا",
    checkOutTime: current?.checkOutTime ?? "١٢ ظهرًا",
    depositPaymentsEnabled: formData.get("depositPaymentsEnabled") === "on",
    telrEnabled: formData.get("telrEnabled") === "on",
    tabbyEnabled: formData.get("tabbyEnabled") === "on",
    tamaraEnabled: formData.get("tamaraEnabled") === "on",
    paymentLinksEnabled: formData.get("paymentLinksEnabled") === "on",
    paymentLinkDays: formData.get("paymentLinkDays") ?? 7,
    heroTitle: formData.get("heroTitle"),
    heroTitleAlt: formData.get("heroTitleAlt") ?? "",
    heroSubtitle: formData.get("heroSubtitle") ?? "",
    footerAbout: formData.get("footerAbout") ?? "",
    seoTitle: formData.get("seoTitle") ?? "",
    seoDescription: formData.get("seoDescription") ?? "",

    googleTagId: formData.get("googleTagId") ?? "",
    googleAdsConversionLabel: formData.get("googleAdsConversionLabel") ?? "",

    siteNameEn: formData.get("siteNameEn") ?? "",
    taglineEn: formData.get("taglineEn") ?? "",
    addressLineEn: formData.get("addressLineEn") ?? "",
    checkInTimeEn: current?.checkInTimeEn ?? "",
    checkOutTimeEn: current?.checkOutTimeEn ?? "",
    seoTitleEn: formData.get("seoTitleEn") ?? "",
    seoDescriptionEn: formData.get("seoDescriptionEn") ?? "",
    heroTitleEn: formData.get("heroTitleEn") ?? "",
    heroTitleAltEn: formData.get("heroTitleAltEn") ?? "",
    heroSubtitleEn: formData.get("heroSubtitleEn") ?? "",
    footerAboutEn: formData.get("footerAboutEn") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: t.validation.checkTheFields, fieldErrors };
  }

  const d = parsed.data;

  // Whichever of the two just gained an hour drops its legacy text; the other
  // keeps it. See `stayHourWrite` in src/lib/clock.ts.
  const checkIn = stayHourWrite(d.checkInHour, {
    arabic: d.checkInTime,
    english: d.checkInTimeEn,
  });
  const checkOut = stayHourWrite(d.checkOutHour, {
    arabic: d.checkOutTime,
    english: d.checkOutTimeEn,
  });

  const stayTimes = {
    checkInHour: checkIn.hour,
    checkInTime: checkIn.arabic,
    checkInTimeEn: checkIn.english,
    checkOutHour: checkOut.hour,
    checkOutTime: checkOut.arabic,
    checkOutTimeEn: checkOut.english,
  };

  try {
    await prisma.siteSettings.upsert({
      where: { id: SETTINGS_ID },
      update: {
        ...d,
        ...stayTimes,
        // Empty string means "no link" — store NULL so the footer can skip it.
        email: d.email || null,
        phone: d.phone || null,
        instagram: d.instagram || null,
        tiktok: d.tiktok || null,
        snapchat: d.snapchat || null,
        youtube: d.youtube || null,
        addressLine: d.addressLine || null,
        seoTitle: d.seoTitle || null,
        seoDescription: d.seoDescription || null,
      },
      create: { id: SETTINGS_ID, ...d, ...stayTimes },
    });
  } catch (error) {
    console.error("saveSettings failed:", error);
    return { ok: false, error: t.validation.settingsSaveFailed };
  }

  // "layout" scope: the root layout is where the name and colours are applied,
  // so this is what makes a rebrand appear across the whole site immediately.
  revalidatePath("/", "layout");

  return { ok: true, message: t.validation.settingsSaved };
}

/** Upload (or replace) the brand logo shown in the header, footer and login. */
export async function uploadLogo(file: File): Promise<ActionResult> {
  await requireAdmin();
  const { t } = await getI18n();

  try {
    const previous = await prisma.siteSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { logoUrl: true },
    });

    // An SVG can reach us with an empty or generic MIME type depending on the
    // uploader's machine; the extension settles it. Nothing is trusted by this
    // relabelling — `prepareLogo` reads the real format out of the bytes.
    const upload = looksLikeSvg(file) ? new File([file], file.name, { type: SVG_TYPE }) : file;

    // Validated here rather than left to the adapter, because the logo accepts
    // SVG and the adapter — shared with every gallery upload — does not. What
    // reaches `save()` below is always one of the four raster types it knows.
    assertValidImage(upload, ALLOWED_LOGO_TYPES);

    const stored = await getStorage().save(await prepareLogo(upload), { folder: "brand" });

    await prisma.siteSettings.upsert({
      where: { id: SETTINGS_ID },
      update: { logoUrl: stored.url },
      create: { id: SETTINGS_ID, logoUrl: stored.url },
    });

    // Don't accumulate replaced logos, wherever they were stored.
    await deleteStoredAsset(previous?.logoUrl);

    revalidatePath("/", "layout");
    return { ok: true, message: t.validation.logoUpdated };
  } catch (error) {
    if (error instanceof UploadError) {
      const byCode: Record<string, string> = {
        NO_FILE: t.validation.uploadNoFile,
        EMPTY: t.validation.uploadEmpty,
        TOO_LARGE: t.validation.uploadTooLarge,
        BAD_FORMAT: t.validation.uploadBadFormat,
      };
      return { ok: false, error: byCode[error.code] ?? t.validation.saveFailed };
    }
    console.error("uploadLogo failed:", error);
    return { ok: false, error: t.validation.logoUploadFailed };
  }
}

export async function removeLogo(): Promise<ActionResult> {
  await requireAdmin();
  const { t } = await getI18n();

  const current = await prisma.siteSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { logoUrl: true },
  });

  await prisma.siteSettings.update({
    where: { id: SETTINGS_ID },
    data: { logoUrl: null },
  });

  await deleteStoredAsset(current?.logoUrl);

  revalidatePath("/", "layout");
  return { ok: true, message: t.validation.logoRemoved };
}

/** Upload the home-page hero background. */
export async function uploadHeroImage(file: File): Promise<ActionResult> {
  await requireAdmin();
  const { t } = await getI18n();

  try {
    const previous = await prisma.siteSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { heroImageUrl: true },
    });

    const stored = await getStorage().save(file, { folder: "brand" });

    await prisma.siteSettings.upsert({
      where: { id: SETTINGS_ID },
      update: { heroImageUrl: stored.url },
      create: { id: SETTINGS_ID, heroImageUrl: stored.url },
    });

    await deleteStoredAsset(previous?.heroImageUrl);

    revalidatePath("/", "layout");
    return { ok: true, message: t.validation.heroUpdated };
  } catch (error) {
    if (error instanceof UploadError) {
      const byCode: Record<string, string> = {
        NO_FILE: t.validation.uploadNoFile,
        EMPTY: t.validation.uploadEmpty,
        TOO_LARGE: t.validation.uploadTooLarge,
        BAD_FORMAT: t.validation.uploadBadFormat,
      };
      return { ok: false, error: byCode[error.code] ?? t.validation.saveFailed };
    }
    console.error("uploadHeroImage failed:", error);
    return { ok: false, error: t.validation.heroUploadFailed };
  }
}
