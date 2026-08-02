import type { Metadata, Viewport } from "next";
import { Almarai, Tajawal } from "next/font/google";
import { getSettings, siteUrl, localizeSettings } from "@/lib/settings";
import { themeCssVars } from "@/lib/theme";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { htmlLang, ogLocale } from "@/lib/i18n/config";
import { LocaleProvider } from "@/lib/i18n/provider";
import "./globals.css";

/**
 * Root layout.
 *
 * Four things happen here that the whole site depends on:
 *  1. `dir` and `lang` are resolved from the visitor's locale cookie and set
 *     once at the document root, so every logical Tailwind utility (ps-*, me-*,
 *     start-*, text-start) flips automatically and no component needs
 *     direction-specific code. Arabic renders `dir="rtl"`, English `dir="ltr"`.
 *  2. Arabic fonts are self-hosted by next/font (no render-blocking request to
 *     Google, no layout shift) and exposed as CSS variables that globals.css
 *     maps to --font-display / --font-sans. Tajawal carries Latin glyphs too,
 *     so English renders in the site's own type system rather than dropping to
 *     a system fallback that would look like a different site.
 *  3. The brand colours are read from the database and written onto <html> as
 *     custom properties, which is what makes /admin/settings able to re-tint
 *     the site with no deploy.
 *  4. `LocaleProvider` puts the locale into React context so client components
 *     ("use client" — the header, cards, forms) can translate without every
 *     server parent threading strings down as props.
 *
 * Reading the cookie makes this layout dynamic; see the note at the top of
 * src/lib/i18n/server.ts for why that trade is the right one.
 */

const almarai = Almarai({
  subsets: ["arabic"],
  weight: ["400", "700", "800"], // display: 800 for h1/h2, 700 for card titles
  variable: "--font-almarai",
  display: "swap",
});

const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "700", "800"],
  variable: "--font-tajawal",
  display: "swap",
});

/**
 * Site-wide metadata, built from the settings row so renaming the site in the
 * dashboard also renames it in search results and social cards — in whichever
 * language the visitor is reading.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const settings = await getSettings();
  const s = localizeSettings(settings, locale);
  const title = s.seoTitle || s.siteName;

  const keywords =
    locale === "en"
      ? [
          "rest houses",
          "chalets",
          "book a rest house",
          "UAE rest houses",
          "Dubai rest houses",
          "Lahbab rest houses",
          "winter camps",
          "wedding venues",
        ]
      : [
          "استراحات",
          "شاليهات",
          "حجز استراحات",
          "استراحات الإمارات",
          "استراحات دبي",
          "استراحات لهباب",
          "مخيمات شتوية",
          "قاعات أعراس",
        ];

  return {
    metadataBase: new URL(siteUrl()),
    title: {
      default: `${s.siteName} — ${title}`,
      // Per-page titles render as "Golden Sands | Sands Rest Houses"
      template: `%s | ${s.siteName}`,
    },
    description: s.seoDescription || undefined,
    applicationName: s.siteName,
    keywords,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      locale: ogLocale(locale),
      siteName: s.siteName,
      title: `${s.siteName} — ${title}`,
      description: s.seoDescription || undefined,
      url: siteUrl(),
      images: [{ url: settings.ogImageUrl || "/api/og", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${s.siteName} — ${title}`,
      description: s.seoDescription || undefined,
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
  const { locale, dir } = await getI18n();

  return (
    <html
      lang={htmlLang(locale)}
      dir={dir}
      className={`${almarai.variable} ${tajawal.variable}`}
      // Theme comes from the database — see src/lib/theme.ts for how four
      // stored hex values expand into the full ramp via color-mix().
      style={themeCssVars(settings)}
      suppressHydrationWarning
    >
      <body className="bg-sand-50 antialiased">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
