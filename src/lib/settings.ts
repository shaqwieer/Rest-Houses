import { cache } from "react";
import { prisma } from "./prisma";
import type { SiteSettings } from "@prisma/client";

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
  mapLat: 24.7614,
  mapLng: 55.334,
  mapZoom: 10,
  addressLine: "دبي — الإمارات العربية المتحدة",
  colorAccent: "#C9A44C",
  colorAccentDeep: "#A8873A",
  colorNight: "#0C1522",
  colorSand: "#FBF7F0",
  serviceFeePercent: 5,
  depositPercent: 30,
  freeCancelHours: 48,
  checkInTime: "٤ عصرًا",
  checkOutTime: "١٢ ظهرًا",
  depositPaymentsEnabled: false,
  seoTitle: "حجز الاستراحات والشاليهات في الإمارات",
  seoDescription:
    "استراحات وشاليهات صحراوية موثّقة في دبي وأبوظبي والعين وليوا والشارقة — أسعار واضحة وتقويم متاح لحظيًا وتأكيد مباشر عبر الواتساب.",
  ogImageUrl: null,
  heroTitle: "استراحتك في قلب الصحراء",
  heroTitleAlt: "تبدأ بحجز واحد",
  heroSubtitle:
    "اختر من بين استراحات وشاليهات مختارة بعناية في لهباب وليوا والعين — أسعار واضحة، تقويم متاح لحظيًا، وتأكيد مباشر مع المالك.",
  heroImageUrl: null,
  footerAbout:
    "منصّة إماراتية لحجز الاستراحات والشاليهات الصحراوية — موثّقة ميدانيًا وبأسعار واضحة.",
  updatedAt: new Date(),
} satisfies SiteSettings;

export type Settings = SiteSettings;

export const getSettings = cache(async (): Promise<Settings> => {
  try {
    const row = await prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } });
    return row ?? FALLBACK;
  } catch {
    // Database unreachable (first boot before `db:push`) — keep the site up.
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
