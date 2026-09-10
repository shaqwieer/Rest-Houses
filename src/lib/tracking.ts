import type { Settings } from "./settings";

/**
 * Tracking configuration — which advertising accounts this site reports to.
 *
 * ─── Identifiers, never code ────────────────────────────────────────────────
 * Every platform in this file hands the operator a block of `<script>` and says
 * "paste it before `</head>`". Storing that block verbatim and printing it back
 * would put an unvalidated string into every page of the site: a stored-XSS
 * surface that one compromised admin session turns into full control of the
 * front end, and a mistyped paste that silently breaks every page.
 *
 * So /admin/tracking takes the *identifier* only, checks it against the shape
 * the platform issues, and src/components/site/tracking-scripts.tsx writes the
 * snippet. That is the same rule the Google tag has followed since it was
 * added; this module simply widens it to Meta, TikTok, Snapchat, GA4 and Tag
 * Manager.
 *
 * ─── Why the regexes are loose ──────────────────────────────────────────────
 * The security property needed here is "no angle brackets, no script body",
 * which a character class plus a length bound delivers on its own. Matching a
 * platform's id format precisely buys nothing on top of that and costs a real
 * operator their working pixel the day the platform issues an id one character
 * longer — and a validation rule that refuses correct data is worse than none,
 * because there is no way around it from the form.
 */

/* -------------------------------------------------------------------------- */
/* Identifier shapes                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Meta pixel — digits. Currently 15 or 16 of them, and the bound is written
 * wider than that on purpose (see the note above).
 */
export const META_PIXEL_RE = /^\d{10,20}$/;

/** TikTok pixel — an upper-case base-36 id, 15-30 characters as issued today. */
export const TIKTOK_PIXEL_RE = /^[A-Z0-9]{10,40}$/;

/** Snap Pixel ID — a UUID, printed lower-case in Snapchat Ads Manager. */
export const SNAPCHAT_PIXEL_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** GA4 measurement id. Only "G-" — an Ads tag belongs in `googleTagId`. */
export const GA4_MEASUREMENT_RE = /^G-[A-Z0-9]{4,20}$/;

/** Tag Manager container. Only "GTM-" — see `gtmContainerId` in the schema. */
export const GTM_CONTAINER_RE = /^GTM-[A-Z0-9]{4,20}$/;

/* -------------------------------------------------------------------------- */
/* The public shape                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Exactly what crosses into the browser.
 *
 * A named type rather than "the settings row minus a few fields", for the same
 * reason `SettingsFormValues` is one: this object is a prop on a client
 * component, so everything in it ships to every visitor. What belongs here is
 * decided by what is safe to publish — every value below is already public by
 * construction, because it ends up inside a `<script>` tag on the page — and
 * never by what happens to sit next to it on the settings row.
 */
export type TrackingConfig = {
  googleTagId: string;
  googleAnalyticsId: string;
  gtmContainerId: string;
  metaPixelId: string;
  tiktokPixelId: string;
  snapchatPixelId: string;
  /** "AW-…/label", or "" when the Ads conversion is not fully configured. */
  adsSendTo: string;
};

export function trackingConfig(settings: Settings): TrackingConfig {
  return {
    googleTagId: settings.googleTagId,
    googleAnalyticsId: settings.googleAnalyticsId,
    gtmContainerId: settings.gtmContainerId,
    metaPixelId: settings.metaPixelId,
    tiktokPixelId: settings.tiktokPixelId,
    snapchatPixelId: settings.snapchatPixelId,
    adsSendTo: googleAdsSendTo(settings),
  };
}

/**
 * Google Ads' `send_to` value — "AW-950802645/AbCdEfGh12ijKLmnOpQr" — or ""
 * when the conversion is not fully configured.
 *
 * The two halves are stored separately so the tag ID is written once and the
 * conversion label cannot drift away from it. Joining them belongs here rather
 * than at the call site: "" from *either* half means no conversion is reported,
 * and a page that assembled the string itself would happily send
 * "AW-950802645/" — a `send_to` Google accepts and silently attributes to
 * nothing.
 */
export function googleAdsSendTo(settings: {
  googleTagId: string;
  googleAdsConversionLabel: string;
}): string {
  if (!settings.googleTagId || !settings.googleAdsConversionLabel) return "";
  return `${settings.googleTagId}/${settings.googleAdsConversionLabel}`;
}

/** True when at least one platform is configured — i.e. anything is reported. */
export function isTrackingLive(config: TrackingConfig): boolean {
  return Boolean(
    config.googleTagId ||
      config.googleAnalyticsId ||
      config.gtmContainerId ||
      config.metaPixelId ||
      config.tiktokPixelId ||
      config.snapchatPixelId,
  );
}

/**
 * The double-counting warning: a Tag Manager container AND a pixel wired up
 * directly here.
 *
 * If the container also fires that pixel — which is the ordinary reason to run
 * a container at all — every page view and every event is counted twice, and
 * the campaign that looks like it doubled its conversions did nothing of the
 * kind.
 *
 * This reports the overlap; it does not resolve it. Silently suppressing one
 * side would leave an operator staring at a tag they configured, that the page
 * says is live, and that never fires — which is a harder bug to find than the
 * double count it avoids.
 */
export function gtmOverlaps(config: TrackingConfig): boolean {
  return Boolean(
    config.gtmContainerId &&
      (config.googleTagId ||
        config.googleAnalyticsId ||
        config.metaPixelId ||
        config.tiktokPixelId ||
        config.snapchatPixelId),
  );
}
