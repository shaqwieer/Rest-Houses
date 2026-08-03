"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { SETTINGS_ID } from "@/lib/settings";
import { deleteStoredAsset, getStorage, UploadError } from "@/lib/storage";
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

  return z.object({
  // identity
    siteName: z.string().trim().min(2, t.validation.siteNameRequired).max(80),
  tagline: z.string().trim().max(120).default(""),
  logoGlyph: z.string().trim().min(1).max(2).default("و"),

  // contact
  whatsappNumber: z
    .string()
    .trim()
    .refine((v) => v.replace(/[^0-9]/g, "").length >= 9, t.validation.whatsappIncomplete),
  phone: z.string().trim().max(40).default(""),
    email: z.string().trim().email(t.validation.invalidEmail).or(z.literal("")).default(""),

  // socials — full URLs so the footer can link them directly
  instagram: z.string().trim().url(t.validation.invalidUrl).or(z.literal("")).default(""),
  tiktok: z.string().trim().url(t.validation.invalidUrl).or(z.literal("")).default(""),
  snapchat: z.string().trim().url(t.validation.invalidUrl).or(z.literal("")).default(""),
  youtube: z.string().trim().url(t.validation.invalidUrl).or(z.literal("")).default(""),

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
  checkInTime: z.string().trim().max(40).default("٤ عصرًا"),
  checkOutTime: z.string().trim().max(40).default("١٢ ظهرًا"),
  depositPaymentsEnabled: z.coerce.boolean().default(false),

  // home hero + SEO
  heroTitle: z.string().trim().max(120),
  heroTitleAlt: z.string().trim().max(120).default(""),
  heroSubtitle: z.string().trim().max(400).default(""),
  footerAbout: z.string().trim().max(400).default(""),
    seoTitle: z.string().trim().max(120).default(""),
    seoDescription: z.string().trim().max(320).default(""),

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
    checkInTime: formData.get("checkInTime") || "٤ عصرًا",
    checkOutTime: formData.get("checkOutTime") || "١٢ ظهرًا",
    depositPaymentsEnabled: formData.get("depositPaymentsEnabled") === "on",
    heroTitle: formData.get("heroTitle"),
    heroTitleAlt: formData.get("heroTitleAlt") ?? "",
    heroSubtitle: formData.get("heroSubtitle") ?? "",
    footerAbout: formData.get("footerAbout") ?? "",
    seoTitle: formData.get("seoTitle") ?? "",
    seoDescription: formData.get("seoDescription") ?? "",

    siteNameEn: formData.get("siteNameEn") ?? "",
    taglineEn: formData.get("taglineEn") ?? "",
    addressLineEn: formData.get("addressLineEn") ?? "",
    checkInTimeEn: formData.get("checkInTimeEn") ?? "",
    checkOutTimeEn: formData.get("checkOutTimeEn") ?? "",
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

  try {
    await prisma.siteSettings.upsert({
      where: { id: SETTINGS_ID },
      update: {
        ...d,
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
      create: { id: SETTINGS_ID, ...d },
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

    const stored = await getStorage().save(file, { folder: "brand" });

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
