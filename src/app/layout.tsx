import type { Metadata, Viewport } from "next";
import { Almarai, Tajawal } from "next/font/google";
import { getSettings, siteUrl } from "@/lib/settings";
import { themeCssVars } from "@/lib/theme";
import "./globals.css";

/**
 * Root layout.
 *
 * Three things happen here that the whole site depends on:
 *  1. `dir="rtl" lang="ar"` — set once at the document root, so every logical
 *     Tailwind utility (ps-*, me-*, start-*, text-start) flips automatically
 *     and no component needs RTL-specific code.
 *  2. Arabic fonts are self-hosted by next/font (no render-blocking request to
 *     Google, no layout shift) and exposed as CSS variables that globals.css
 *     maps to --font-display / --font-sans.
 *  3. The brand colours are read from the database and written onto <html> as
 *     custom properties, which is what makes /admin/settings able to re-tint
 *     the site with no deploy.
 */

const almarai = Almarai({
  subsets: ["arabic"],
  weight: ["400", "700", "800"], // display: 800 for h1/h2, 700 for card titles
  variable: "--font-almarai",
  display: "swap",
});

const tajawal = Tajawal({
  subsets: ["arabic"],
  weight: ["300", "400", "500", "700", "800"],
  variable: "--font-tajawal",
  display: "swap",
});

/**
 * Site-wide metadata, built from the settings row so renaming the site in the
 * dashboard also renames it in search results and social cards.
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const title = settings.seoTitle || settings.siteName;

  return {
    metadataBase: new URL(siteUrl()),
    title: {
      default: `${settings.siteName} — ${title}`,
      // Per-page titles render as "استراحة الرمال الذهبية | استراحات الرمال"
      template: `%s | ${settings.siteName}`,
    },
    description: settings.seoDescription ?? undefined,
    applicationName: settings.siteName,
    keywords: [
      "استراحات",
      "شاليهات",
      "حجز استراحات",
      "استراحات الإمارات",
      "استراحات دبي",
      "استراحات لهباب",
      "مخيمات شتوية",
      "قاعات أعراس",
    ],
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      locale: "ar_AE",
      siteName: settings.siteName,
      title: `${settings.siteName} — ${title}`,
      description: settings.seoDescription ?? undefined,
      url: siteUrl(),
      images: [{ url: settings.ogImageUrl || "/api/og", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${settings.siteName} — ${title}`,
      description: settings.seoDescription ?? undefined,
    },
    robots: { index: true, follow: true },
    formatDetection: { telephone: true },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const settings = await getSettings();
  return {
    width: "device-width",
    initialScale: 1,
    // Colours the mobile browser chrome to match the dark header strip.
    themeColor: settings.colorNight,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const settings = await getSettings();

  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${almarai.variable} ${tajawal.variable}`}
      // Theme comes from the database — see src/lib/theme.ts for how four
      // stored hex values expand into the full ramp via color-mix().
      style={themeCssVars(settings)}
      suppressHydrationWarning
    >
      <body className="bg-sand-50 antialiased">{children}</body>
    </html>
  );
}
