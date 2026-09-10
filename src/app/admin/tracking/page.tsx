import { TrackingForm } from "@/components/admin/tracking-form";
import { getSettings } from "@/lib/settings";
import { gtmOverlaps, trackingConfig } from "@/lib/tracking";
import { requireAdminPage } from "@/lib/auth";

/**
 * Tracking & measurement — the advertising configuration, on its own page.
 *
 * This was two fields at the bottom of /admin/settings. It is a page now
 * because it belongs to a different reader: the media buyer connects the
 * accounts, checks the events against each platform's test console, and comes
 * back whenever an ad account moves — none of which has anything to do with the
 * site's name, colours or fees.
 *
 * Nothing sensitive crosses into the browser here. Every value on this page is
 * public by construction: each one ends up inside a `<script>` tag served to
 * every visitor.
 */
export default async function AdminTrackingPage() {
  await requireAdminPage();

  const settings = await getSettings();

  return (
    <TrackingForm
      values={{
        googleTagId: settings.googleTagId,
        googleAdsConversionLabel: settings.googleAdsConversionLabel,
        googleAnalyticsId: settings.googleAnalyticsId,
        gtmContainerId: settings.gtmContainerId,
        metaPixelId: settings.metaPixelId,
        tiktokPixelId: settings.tiktokPixelId,
        snapchatPixelId: settings.snapchatPixelId,
        ownerAreaTracking: settings.ownerAreaTracking,
      }}
      // Computed from the saved row, so the warning describes what the site is
      // doing rather than what is currently typed into the form.
      gtmOverlap={gtmOverlaps(trackingConfig(settings))}
    />
  );
}
