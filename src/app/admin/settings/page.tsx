import { SettingsForm } from "@/components/admin/settings-form";
import { getSettings } from "@/lib/settings";
import { depositPaymentStatus } from "@/lib/payments";
import { requireAdminPage } from "@/lib/auth";

/** Site settings — the config-driven branding surface. */
export default async function AdminSettingsPage() {
  await requireAdminPage();

  const settings = await getSettings();

  return (
    <SettingsForm
      // Nulls become empty strings so the inputs are controlled/uncontrolled
      // consistently and React doesn't warn about a null `defaultValue`.
      values={{
        siteName: settings.siteName,
        tagline: settings.tagline,
        logoGlyph: settings.logoGlyph,
        logoUrl: settings.logoUrl,
        heroImageUrl: settings.heroImageUrl,
        whatsappNumber: settings.whatsappNumber,
        phone: settings.phone ?? "",
        email: settings.email ?? "",
        instagram: settings.instagram ?? "",
        tiktok: settings.tiktok ?? "",
        snapchat: settings.snapchat ?? "",
        youtube: settings.youtube ?? "",
        mapLat: settings.mapLat,
        mapLng: settings.mapLng,
        mapZoom: settings.mapZoom,
        addressLine: settings.addressLine ?? "",
        colorAccent: settings.colorAccent,
        colorAccentDeep: settings.colorAccentDeep,
        colorNight: settings.colorNight,
        colorSand: settings.colorSand,
        serviceFeePercent: settings.serviceFeePercent,
        depositPercent: settings.depositPercent,
        freeCancelHours: settings.freeCancelHours,
        checkInTime: settings.checkInTime,
        checkOutTime: settings.checkOutTime,
        depositPaymentsEnabled: settings.depositPaymentsEnabled,
        heroTitle: settings.heroTitle,
        heroTitleAlt: settings.heroTitleAlt,
        heroSubtitle: settings.heroSubtitle,
        footerAbout: settings.footerAbout,
        seoTitle: settings.seoTitle ?? "",
        seoDescription: settings.seoDescription ?? "",

        // English copy — blank means "fall back to the Arabic value".
        siteNameEn: settings.siteNameEn ?? "",
        taglineEn: settings.taglineEn ?? "",
        addressLineEn: settings.addressLineEn ?? "",
        checkInTimeEn: settings.checkInTimeEn ?? "",
        checkOutTimeEn: settings.checkOutTimeEn ?? "",
        seoTitleEn: settings.seoTitleEn ?? "",
        seoDescriptionEn: settings.seoDescriptionEn ?? "",
        heroTitleEn: settings.heroTitleEn ?? "",
        heroTitleAltEn: settings.heroTitleAltEn ?? "",
        heroSubtitleEn: settings.heroSubtitleEn ?? "",
        footerAboutEn: settings.footerAboutEn ?? "",
      }}
      // A code, not a sentence — the form resolves it against the dictionary.
      paymentState={depositPaymentStatus(settings)}
    />
  );
}
