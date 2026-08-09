import Image from "next/image";
import Link from "next/link";
import clsx from "clsx";
import { DEFAULT_LOCALE, localized, type Locale } from "@/lib/i18n/config";
import type { Settings } from "@/lib/settings";

/**
 * The logo lockup.
 *
 * ─── Two shapes, not one ────────────────────────────────────────────────────
 * With a logo uploaded, the image *is* the lockup: it replaces the site-name
 * text rather than sitting in a tile beside it. A brand's logo is almost always
 * a wordmark that already contains the name — printing the name again next to
 * it says everything twice and leaves the mark about sixteen pixels tall to say
 * it in.
 *
 * With no logo, the original fallback stands: a gold-gradient tile carrying the
 * single-letter glyph from settings (default "و"), plus the name. A fresh
 * install still looks deliberate rather than showing a broken image.
 *
 * ─── Why `object-contain` and a height, not a square ────────────────────────
 * The tile cropped the logo into a 40px square with `object-cover`. A wordmark
 * is roughly 2:1, so that threw away most of it and shrank what was left. Here
 * the image is given a height and `w-auto`: it keeps its own proportions, at
 * whatever width they imply, and nothing is cut. `max-width` is the only limit,
 * so a very wide mark cannot push the navigation off the bar.
 *
 * ─── The dark surfaces ──────────────────────────────────────────────────────
 * The header is sand and the footer is night-900, and one image file cannot
 * read on both — a mark drawn in dark ink disappears into the footer, a mark
 * drawn in gold or white disappears into the header. So on `tone="dark"` the
 * logo is set on a light chip. That costs a small card behind it and works for
 * any logo the operator uploads, which the alternative — asking them to prepare
 * and maintain a second file for dark backgrounds — does not.
 */
export function Brand({
  settings,
  size = "md",
  tone = "light",
  showTagline = false,
  href = "/",
  locale = DEFAULT_LOCALE,
}: {
  settings: Settings;
  size?: "sm" | "md" | "lg";
  /** "light" = dark text on sand; "dark" = light text on night. */
  tone?: "light" | "dark";
  showTagline?: boolean;
  href?: string | null;
  /**
   * Which language the name and tagline are read in. Defaults to Arabic — the
   * site's default locale — so a caller with no locale to hand behaves as this
   * component always did.
   */
  locale?: Locale;
}) {
  const dims = {
    sm: { tile: 32, radius: "rounded-[10px]", glyph: "text-[15px]", name: "text-[15px]", logo: 30, logoMax: 150 },
    md: { tile: 40, radius: "rounded-xl", glyph: "text-[19px]", name: "text-[17px]", logo: 40, logoMax: 190 },
    lg: { tile: 42, radius: "rounded-[13px]", glyph: "text-[20px]", name: "text-[17px]", logo: 48, logoMax: 230 },
  }[size];

  // The English columns are optional and fall back to the Arabic ones, so this
  // is safe on a site that has never filled them in. Reading `settings.siteName`
  // raw — as this component used to — meant an operator who edited the English
  // name watched the header keep the Arabic one, with nothing to explain why.
  const name = localized(settings.siteName, settings.siteNameEn, locale);
  const tagline = localized(settings.tagline, settings.taglineEn, locale);

  const tagLine = showTagline && tagline && (
    <span
      className={clsx(
        "block text-[11px] tracking-wide",
        tone === "dark" ? "text-sand-100/50" : "text-muted",
      )}
    >
      {tagline}
    </span>
  );

  let inner;

  if (settings.logoUrl) {
    const image = (
      <Image
        src={settings.logoUrl}
        // The name the logo replaces, so it is still what a screen reader
        // announces and what search engines read for the site's own link.
        alt={name}
        // These only size the request and reserve space; the CSS below wins on
        // the rendered box, so a logo of any proportion keeps its own.
        width={dims.logoMax}
        height={dims.logo}
        className="w-auto object-contain"
        style={{ height: dims.logo, maxWidth: dims.logoMax }}
        // Next re-encodes at quality 75 by default, which is tuned for
        // photographs. On the flat fills and hard edges of a logo that is where
        // the fuzz around the letters comes from — and at this size the
        // difference between 75 and 100 is a few kilobytes.
        quality={100}
        priority
      />
    );

    inner = (
      <span className="flex min-w-0 flex-col items-start gap-1">
        {tone === "dark" ? (
          <span className="inline-flex rounded-md bg-sand-50 px-2.5 py-1.5">{image}</span>
        ) : (
          image
        )}
        {tagLine}
      </span>
    );
  } else {
    inner = (
      <>
        <span
          className={clsx("grid shrink-0 place-items-center", dims.radius)}
          style={{
            width: dims.tile,
            height: dims.tile,
            background: "linear-gradient(150deg, var(--gold-500), var(--bronze))",
          }}
        >
          <span
            className={clsx("font-display font-extrabold text-night-900", dims.glyph)}
            aria-hidden
          >
            {settings.logoGlyph || "و"}
          </span>
        </span>

        <span className="min-w-0 text-start">
          <span
            className={clsx(
              "block font-display font-extrabold leading-tight",
              dims.name,
              tone === "dark" ? "text-sand-50" : "text-ink",
            )}
          >
            {name}
          </span>
          {tagLine}
        </span>
      </>
    );
  }

  if (!href) {
    return <span className="flex items-center gap-2.5">{inner}</span>;
  }

  return (
    <Link href={href} className="flex items-center gap-2.5 no-underline hover:no-underline">
      {inner}
    </Link>
  );
}
