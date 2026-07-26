import { ICON_PATHS, ICON_VIEWBOX, type IconName } from "./icon-paths";

export type { IconName };

type IconProps = {
  name: IconName;
  /** Rendered size in px — matches the design's `font-size` on the glyph span. */
  size?: number;
  className?: string;
  /** Decorative by default. Pass a label when the icon is the only content. */
  label?: string;
};

/**
 * Inline Material Symbols glyph.
 *
 * Fills with `currentColor`, so colour comes from the surrounding text class
 * (`text-bronze`, `text-busy`, …) exactly like the icon font in the design did.
 * `aria-hidden` unless a label is supplied: almost every icon here sits beside
 * its own text and would otherwise be announced twice.
 */
export function Icon({ name, size = 20, className, label }: IconProps) {
  const d = ICON_PATHS[name];

  return (
    <svg
      viewBox={ICON_VIEWBOX}
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      // Keeps the glyph optically aligned with the text baseline beside it.
      style={{ flex: "0 0 auto", display: "block" }}
    >
      <path d={d} />
    </svg>
  );
}
