import { cache } from "react";
import { prisma } from "./prisma";
import type { SiteSettings } from "@prisma/client";
import { DEFAULT_LOCALE, localized, type Locale } from "./i18n/config";

/**
 * Site settings access.
 *
 * Every brandable value (name, colours, WhatsApp number, contacts, map, fees)
 * lives in one database row so the owner can rebrand from /admin/settings with
 * no code change and no redeploy. Components must read settings through
 * `getSettings()` rather than importing constants — that's the whole contract.
 *
 * `cache()` de-duplicates the query within a single server render, so a page
 * whose header, footer and body all need settings still issues one SELECT.
 */

export const SETTINGS_ID = 1;

/**
 * Fallbacks used only if the settings row is missing (e.g. a fresh database
 * that hasn't been seeded). The site renders rather than 500s.
 */
const FALLBACK = {
  id: SETTINGS_ID,
  siteName: process.env.SITE_NAME || "استراحات الرمال",
  tagline: "استراحات وشاليهات الإمارات",
  logoUrl: null,
  logoGlyph: "و",
  whatsappNumber: process.env.WHATSAPP_NUMBER || "+971500000000",
  phone: process.env.WHATSAPP_NUMBER || "+971500000000",
  email: process.env.CONTACT_EMAIL || "hello@example.ae",
  instagram: "",
  tiktok: "",
  snapchat: "",
  youtube: "",
  // Empty, not a plausible-looking example. A fresh install must show owners no
  // bank account rather than one they might actually try to pay into, and the
  // footer must show no licence number rather than an invented one.
  bankName: "",
  bankAccountHolder: "",
  bankAccountNumber: "",
  bankIban: "",
  tradeLicense: "",
  mapLat: 24.7614,
  mapLng: 55.334,
  mapZoom: 10,
  addressLine: "دبي — الإمارات العربية المتحدة",
  colorAccent: "#C9A44C",
  colorAccentDeep: "#A8873A",
  colorNight: "#0C1522",
  colorSand: "#FBF7F0",
  // 0, matching the column default: a fresh install that has not been seeded
  // must not quietly re-earn the 5% fee the platform stopped charging.
  serviceFeePercent: 0,
  depositPercent: 30,
  freeCancelHours: 48,
  // The platform's own cut, paid by the owner at step 6 of the handover
  // workflow — not the guest-facing service fee above it, which is 0. See
  // `platformCommission()` in src/lib/pricing.ts.
  commissionPercent: 5,
  reviewInviteDays: 15,
  // null, not 16/12: the fallback chain in src/lib/policies.ts reads the legacy
  // text below whenever the hour is unset, and a fresh install with no settings
  // row should behave exactly like one whose operator has not picked an hour.
  checkInHour: null,
  checkOutHour: null,
  checkInTime: "٤ عصرًا",
  checkOutTime: "١٢ ظهرًا",
  // The master switch for online payments, and the three gateways behind it.
  // All false on an unseeded install, matching the column defaults: no
  // credentials exist for any provider, and a fresh database must not advertise
  // a checkout it cannot complete. See src/lib/payments/config.ts.
  depositPaymentsEnabled: false,
  telrEnabled: false,
  tabbyEnabled: false,
  tamaraEnabled: false,
  paymentLinksEnabled: false,
  paymentLinkDays: 7,
  seoTitle: "حجز الاستراحات والشاليهات في الإمارات",
  seoDescription:
    "استراحات وشاليهات صحراوية موثّقة في دبي وأبوظبي والعين وليوا والشارقة — أسعار واضحة وتقويم متاح لحظيًا وتأكيد مباشر عبر الواتساب.",
  ogImageUrl: null,
  // No Google tag until an operator types one into /admin/settings. An
  // unseeded install must report to nobody rather than to whichever account the
  // sample data happened to name.
  googleTagId: "",
  googleAdsConversionLabel: "",
  heroTitle: "استراحتك في قلب الصحراء",
  heroTitleAlt: "تبدأ بحجز واحد",
  heroSubtitle:
    "اختر من بين استراحات وشاليهات مختارة بعناية في لهباب وليوا والعين — أسعار واضحة، تقويم متاح لحظيًا، وتأكيد مباشر مع المالك.",
  heroImageUrl: null,
  footerAbout:
    "منصّة إماراتية لحجز الاستراحات والشاليهات الصحراوية — موثّقة ميدانيًا وبأسعار واضحة.",

  // English siblings — blank means "fall back to the Arabic value", which is
  // what `localized()` below does. See prisma/schema.prisma for why they exist.
  siteNameEn: "Sands Rest Houses",
  taglineEn: "Rest houses & chalets across the UAE",
  addressLineEn: "Dubai — United Arab Emirates",
  checkInTimeEn: "4 PM",
  checkOutTimeEn: "12 noon",
  seoTitleEn: "Book rest houses and chalets in the UAE",
  seoDescriptionEn:
    "Verified desert rest houses and chalets across Abu Dhabi, Dubai, Sharjah, Ras Al Khaimah, Ajman, Umm Al Quwain and Fujairah — clear pricing, a live calendar, and direct confirmation on WhatsApp.",
  heroTitleEn: "Your rest house in the heart of the desert",
  heroTitleAltEn: "is one booking away",
  heroSubtitleEn:
    "Choose from carefully selected rest houses and chalets in Lahbab, Liwa and Al Ain — clear pricing, a live calendar, and direct confirmation with the owner.",
  footerAboutEn:
    "An Emirati platform for booking desert rest houses and chalets — verified in person, with clear pricing.",

  updatedAt: new Date(),
} satisfies SiteSettings;

export type Settings = SiteSettings;

/**
 * Re-exported so the settings call sites below read as they always did.
 *
 * The implementation moved to src/lib/i18n/config.ts when listings gained their
 * own English columns: the listing card resolves a rest house's name in the
 * browser, and a client bundle cannot import this module (Prisma).
 */
export { localized };

/**
 * Every localisable settings field, resolved for one locale at once.
 *
 * Returned as a plain object of strings so it can be handed straight to a
 * client component as a prop — unlike the dictionary, which contains functions
 * and cannot cross the server/client boundary.
 */
export type LocalizedSettings = ReturnType<typeof localizeSettings>;

export function localizeSettings(settings: Settings, locale: Locale = DEFAULT_LOCALE) {
  return {
    siteName: localized(settings.siteName, settings.siteNameEn, locale),
    tagline: localized(settings.tagline, settings.taglineEn, locale),
    addressLine: localized(settings.addressLine, settings.addressLineEn, locale),
    checkInTime: localized(settings.checkInTime, settings.checkInTimeEn, locale),
    checkOutTime: localized(settings.checkOutTime, settings.checkOutTimeEn, locale),
    seoTitle: localized(settings.seoTitle, settings.seoTitleEn, locale),
    seoDescription: localized(settings.seoDescription, settings.seoDescriptionEn, locale),
    heroTitle: localized(settings.heroTitle, settings.heroTitleEn, locale),
    heroTitleAlt: localized(settings.heroTitleAlt, settings.heroTitleAltEn, locale),
    heroSubtitle: localized(settings.heroSubtitle, settings.heroSubtitleEn, locale),
    footerAbout: localized(settings.footerAbout, settings.footerAboutEn, locale),
  };
}

/**
 * Just the bank fields, as the shape the commission step takes.
 *
 * A named picker rather than passing the whole settings row into the workflow
 * component: that row carries the operator's email, the site's private map
 * coordinates and every piece of SEO copy, none of which has any business
 * crossing into a client bundle rendered for an owner. Four fields go, and it
 * is obvious at the call site which four.
 */
export function bankDetails(settings: Settings) {
  return {
    bankName: settings.bankName,
    bankAccountHolder: settings.bankAccountHolder,
    bankAccountNumber: settings.bankAccountNumber,
    bankIban: settings.bankIban,
  };
}

/**
 * Google Ads' `send_to` value — "AW-950802645/dVoECJ30sOQcENWxsMUD" — or "" when
 * the conversion is not fully configured.
 *
 * The two halves are stored separately so the tag ID is written once and the
 * conversion label cannot drift away from it. Joining them belongs here rather
 * than at the call site: "" from *either* half means no conversion is reported,
 * and a page that assembled the string itself would happily send "AW-950802645/"
 * — a `send_to` Google accepts and silently attributes to nothing.
 */
export function googleAdsSendTo(settings: Settings): string {
  if (!settings.googleTagId || !settings.googleAdsConversionLabel) return "";
  return `${settings.googleTagId}/${settings.googleAdsConversionLabel}`;
}

export const getSettings = cache(async (): Promise<Settings> => {
  try {
    const row = await prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } });
    return row ?? FALLBACK;
  } catch {
    // Database unreachable (first boot before migrations) — keep the site up.
    return FALLBACK;
  }
});

/** Absolute site origin, needed for canonical URLs, sitemap and OG images. */
export function siteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

/** Build an absolute URL from a site-relative path. */
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
