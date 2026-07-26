import Image from "next/image";
import Link from "next/link";
import clsx from "clsx";
import type { Settings } from "@/lib/settings";

/**
 * The logo lockup: a gold-gradient monogram tile plus the site name.
 *
 * Falls back to the single-letter glyph from settings (default "و") when no
 * logo image has been uploaded — so a fresh install still looks deliberate
 * rather than showing a broken image.
 */
export function Brand({
  settings,
  size = "md",
  tone = "light",
  showTagline = false,
  href = "/",
}: {
  settings: Settings;
  size?: "sm" | "md" | "lg";
  /** "light" = dark text on sand; "dark" = light text on night. */
  tone?: "light" | "dark";
  showTagline?: boolean;
  href?: string | null;
}) {
  const dims = {
    sm: { tile: 32, radius: "rounded-[10px]", glyph: "text-[15px]", name: "text-[15px]" },
    md: { tile: 40, radius: "rounded-xl", glyph: "text-[19px]", name: "text-[17px]" },
    lg: { tile: 42, radius: "rounded-[13px]", glyph: "text-[20px]", name: "text-[17px]" },
  }[size];

  const inner = (
    <>
      <span
        className={clsx(
          "grid shrink-0 place-items-center bg-linear-[150deg,var(--gold-500),var(--bronze))]",
          dims.radius,
        )}
        style={{
          width: dims.tile,
          height: dims.tile,
          background: "linear-gradient(150deg, var(--gold-500), var(--bronze))",
        }}
      >
        {settings.logoUrl ? (
          <Image
            src={settings.logoUrl}
            alt={settings.siteName}
            width={dims.tile}
            height={dims.tile}
            className={clsx("size-full object-cover", dims.radius)}
          />
        ) : (
          <span
            className={clsx("font-display font-extrabold text-night-900", dims.glyph)}
            aria-hidden
          >
            {settings.logoGlyph || "و"}
          </span>
        )}
      </span>

      <span className="min-w-0 text-start">
        <span
          className={clsx(
            "block font-display font-extrabold leading-tight",
            dims.name,
            tone === "dark" ? "text-sand-50" : "text-ink",
          )}
        >
          {settings.siteName}
        </span>
        {showTagline && (
          <span
            className={clsx(
              "block text-[11px] tracking-wide",
              tone === "dark" ? "text-sand-100/50" : "text-muted",
            )}
          >
            {settings.tagline}
          </span>
        )}
      </span>
    </>
  );

  if (!href) {
    return <span className="flex items-center gap-2.5">{inner}</span>;
  }

  return (
    <Link href={href} className="flex items-center gap-2.5 no-underline hover:no-underline">
      {inner}
    </Link>
  );
}
