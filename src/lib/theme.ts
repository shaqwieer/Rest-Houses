import type { Settings } from "./settings";

/**
 * Turn the four brand colours stored in the database into the CSS custom
 * properties the stylesheet is built on.
 *
 * The palette in globals.css is defined as `var(--gold-500)` etc., so writing
 * these onto <html> at request time re-tints the entire site — buttons, chips,
 * calendar selection, gradients — without touching a component. Derived shades
 * are computed with `color-mix()` so the owner only has to pick 4 colours from
 * /admin/settings rather than eighteen.
 */

/** A safety net: only accept #RGB / #RRGGBB so a bad settings value can never
 *  inject arbitrary CSS into the style attribute. */
function safeHex(value: string | null | undefined, fallback: string): string {
  if (typeof value === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())) {
    return value.trim();
  }
  return fallback;
}

export function themeCssVars(settings: Settings): React.CSSProperties {
  const accent = safeHex(settings.colorAccent, "#C9A44C");
  const accentDeep = safeHex(settings.colorAccentDeep, "#A8873A");
  const night = safeHex(settings.colorNight, "#0C1522");
  const sand = safeHex(settings.colorSand, "#FBF7F0");

  return {
    // Accent ramp — 100/300 are tints of the chosen accent, 500/600 are exact.
    "--gold-100": `color-mix(in srgb, ${accent} 22%, white)`,
    "--gold-300": `color-mix(in srgb, ${accent} 62%, white)`,
    "--gold-500": accent,
    "--gold-600": accentDeep,
    "--bronze": `color-mix(in srgb, ${accentDeep} 78%, #3A2A12)`,

    // Night ramp — successively lighter surfaces off the chosen night colour.
    "--night-900": night,
    "--night-800": `color-mix(in srgb, ${night} 88%, #2B4162)`,
    "--night-700": `color-mix(in srgb, ${night} 68%, #2B4162)`,
    "--night-600": `color-mix(in srgb, ${night} 42%, #2B4162)`,

    // Sand ramp — page and card surfaces.
    "--sand-50": sand,
    "--sand-100": `color-mix(in srgb, ${sand} 88%, ${accent})`,
    "--sand-200": `color-mix(in srgb, ${sand} 74%, ${accent})`,
    "--sand-300": `color-mix(in srgb, ${sand} 58%, ${accent})`,
    "--sand-400": `color-mix(in srgb, ${sand} 42%, ${accent})`,
    "--line": `color-mix(in srgb, ${sand} 80%, ${accentDeep})`,
    "--surface": `color-mix(in srgb, ${sand} 55%, white)`,
  } as React.CSSProperties;
}
