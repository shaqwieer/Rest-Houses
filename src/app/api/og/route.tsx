import { ImageResponse } from "next/og";
import { getSettings } from "@/lib/settings";

/**
 * Dynamic Open Graph image — the card shown when a link is shared on WhatsApp,
 * Twitter/X, Telegram or Slack. WhatsApp is the primary sharing channel for this
 * audience, which makes this more than a nicety.
 *
 *   /api/og                                          → site-wide card
 *   /api/og?title=…&area=…&price=…&capacity=…        → per-listing card
 *
 * Runs on the NODE runtime, not edge. `next/og` works on both, but this route
 * reads site settings through Prisma, and Prisma Client cannot run on the edge
 * runtime without Accelerate or a driver adapter ("In order to run Prisma Client
 * on edge runtime, either: …"). Node is also the right choice for a self-hosted
 * deployment, which has no edge tier to begin with.
 *
 * Fonts: Satori ships no system fonts, so an Arabic-capable font must be fetched
 * and passed in explicitly — without it every Arabic glyph renders as a tofu box.
 */
export const runtime = "nodejs";

/** Cache aggressively: the card for a given listing only changes when its name
 *  or price does, and both are in the query string. */
export const revalidate = 86400;

const WIDTH = 1200;
const HEIGHT = 630;

/**
 * Fetch Almarai from Google Fonts as a raw font buffer for Satori.
 *
 * IMPORTANT — do not send a browser User-Agent here. Google Fonts content-
 * negotiates on it: a Chrome UA gets **woff2**, which Satori cannot parse
 * ("Unsupported OpenType signature wOF2"). The default fetch UA gets a plain
 * TTF, which is what Satori needs. It is a larger download, but `&text=` below
 * subsets the file to only the glyphs this card actually draws.
 */
async function loadArabicFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=Almarai:wght@800&text=${encodeURIComponent(text)}`;
    const css = await fetch(cssUrl).then((r) => r.text());

    // Prefer an explicitly non-woff2 source if several are offered.
    const urls = [...css.matchAll(/url\((https:\/\/[^)]+)\)/g)].map((m) => m[1]);
    const src = urls.find((u) => !u.endsWith(".woff2")) ?? urls[0];
    if (!src) return null;

    const font = await fetch(src);
    if (!font.ok) return null;
    return await font.arrayBuffer();
  } catch {
    // Network blocked or Google unreachable — fall through to the no-font path,
    // which still returns a valid image rather than a broken share card.
    return null;
  }
}

/**
 * Fix RTL word order for Satori.
 *
 * Satori shapes Arabic glyphs correctly (letters join as they should) but does
 * NOT implement the Unicode bidirectional algorithm: it lays word runs out
 * left-to-right regardless of `direction: rtl`, so "استراحة الرمال الذهبية"
 * renders visually as "الذهبية الرمال استراحة". Verified against
 * container-level rtl, element-level rtl and flex row-reverse — none of them
 * reorder the words.
 *
 * Reversing the whitespace-separated tokens ourselves cancels that out: Satori
 * then places the last token first, which is where it belongs on screen.
 * Intra-token order is untouched, so Arabic-Indic numerals ("١٬٨٠٠"), Latin
 * words and phone numbers keep their internal direction.
 *
 * This is only needed inside the OG image. Real HTML pages use the browser's
 * bidi engine and must never be pre-reversed.
 */
function rtl(text: string): string {
  return text.trim().split(/\s+/).reverse().join(" ");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const settings = await getSettings();

  const title = searchParams.get("title") || settings.siteName;
  const area = searchParams.get("area") || settings.tagline;
  const price = searchParams.get("price");
  const capacity = searchParams.get("capacity");

  const accent = settings.colorAccent;
  const night = settings.colorNight;
  const sand = settings.colorSand;

  // "درهم" spelled out rather than the "د.إ" abbreviation: Satori splits a
  // dotted token into sub-runs and reorders them, so "د.إ" comes out as "إ.د".
  // The full word has no internal punctuation and renders correctly.
  const priceLine = price ? `من ${Number(price).toLocaleString("ar-EG")} درهم / الليلة` : "";
  const capacityLine = capacity ? `تتسع حتى ${Number(capacity).toLocaleString("ar-EG")} ضيف` : "";

  // Every glyph that appears anywhere in the image must be in the subset.
  const glyphText = [
    title,
    area,
    priceLine,
    capacityLine,
    settings.siteName,
    settings.logoGlyph,
    "استراحات وشاليهات درهم الليلة",
    "٠١٢٣٤٥٦٧٨٩",
  ].join(" ");

  const fontData = await loadArabicFont(glyphText);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: night,
          padding: 64,
          direction: "rtl",
          position: "relative",
        }}
      >
        {/* the sadu weave, rebuilt as a repeating gradient Satori understands */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `repeating-linear-gradient(45deg, transparent 0 24px, ${accent}14 24px 27px), repeating-linear-gradient(-45deg, transparent 0 24px, ${accent}14 24px 27px)`,
          }}
        />

        {/* brand row */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: 20,
              background: accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 36,
              fontWeight: 800,
              color: night,
            }}
          >
            {settings.logoGlyph}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 30, fontWeight: 800, color: sand }}>{rtl(settings.siteName)}</div>
            <div style={{ fontSize: 20, color: `${sand}99` }}>{rtl("استراحات وشاليهات الإمارات")}</div>
          </div>
        </div>

        {/* title */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: title.length > 40 ? 58 : 72,
              fontWeight: 800,
              color: sand,
              lineHeight: 1.2,
              maxWidth: 980,
            }}
          >
            {rtl(title)}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            {area && (
              <div
                style={{
                  fontSize: 30,
                  color: accent,
                  padding: "10px 26px",
                  borderRadius: 999,
                  border: `2px solid ${accent}66`,
                }}
              >
                {rtl(area)}
              </div>
            )}
            {capacityLine && (
              <div style={{ fontSize: 28, color: `${sand}CC` }}>{rtl(capacityLine)}</div>
            )}
          </div>
        </div>

        {/* price footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `2px solid ${accent}33`,
            paddingTop: 28,
          }}
        >
          <div style={{ fontSize: 36, fontWeight: 800, color: accent }}>{rtl(priceLine)}</div>
          <div style={{ fontSize: 24, color: `${sand}88` }}>{settings.whatsappNumber}</div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      // Without an Arabic font Satori draws tofu boxes; falling back to no
      // custom font at least still produces a valid (Latin-only) image rather
      // than a 500 that leaves the share card blank.
      fonts: fontData
        ? [{ name: "Almarai", data: fontData, weight: 800 as const, style: "normal" as const }]
        : [],
    },
  );
}
