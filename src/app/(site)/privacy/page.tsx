import type { Metadata } from "next";
import { PageHeader, Prose } from "@/components/site/page-shell";
import { getSettings } from "@/lib/settings";
import { trackingConfig } from "@/lib/tracking";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t.pages.privacyTitle,
    description: t.pages.privacyDescription,
    alternates: { canonical: "/privacy" },
  };
}

/**
 * Privacy policy. Describes what this codebase actually does — the booking form
 * fields, the localStorage favourites, the map tile provider — rather than
 * boilerplate that would be inaccurate.
 *
 * Two things changed with this release, and the text had to follow:
 *   • The maps clause no longer mentions Google Maps. It was there because the
 *     footer embedded a Google map on every page; that embed has been removed,
 *     so the only remaining third-party map is the OpenStreetMap/CARTO tiles on
 *     a rest house's own page. A privacy policy that still named Google would
 *     now be describing a request the site does not make.
 *   • An "owner accounts" section was added, because owner registration now
 *     collects business details that did not exist before.
 *
 * The measurement section follows the same rule and is why it is conditional:
 * it names the platforms that are actually connected on this deployment, read
 * from the settings row. A site with no pixel configured does not claim to be
 * measured, and a site that connects one tomorrow says so without anybody
 * having to remember to edit this page.
 */
export default async function PrivacyPage() {
  const [settings, { t }] = await Promise.all([getSettings(), getI18n()]);

  // Named in the visitor's own terms, not as identifiers. "Meta (Facebook and
  // Instagram)" is what somebody deciding whether to block a cookie needs;
  // "123456789012345" is not.
  const config = trackingConfig(settings);
  const platforms = [
    config.googleTagId || config.googleAnalyticsId || config.gtmContainerId ? "Google" : null,
    config.metaPixelId ? "Meta (Facebook · Instagram)" : null,
    config.tiktokPixelId ? "TikTok" : null,
    config.snapchatPixelId ? "Snapchat" : null,
  ].filter(Boolean) as string[];

  return (
    <>
      <PageHeader title={t.pages.privacyTitle} subtitle={t.pages.privacySubtitle} />

      <div className="mx-auto max-w-[900px] px-4 py-10 md:px-10 md:py-14">
        <Prose>
          <h2>{t.pages.privCollectH}</h2>
          <p>{t.pages.privCollectLead}</p>
          <ul>
            <li>{t.pages.privCollectL1}</li>
            <li>{t.pages.privCollectL2}</li>
            <li>{t.pages.privCollectL3}</li>
          </ul>
          <p>{t.pages.privNoCards}</p>

          <h2>{t.pages.privWhyH}</h2>
          <p>{t.pages.privWhyB}</p>

          <h2>{t.pages.privOwnerH}</h2>
          <p>{t.pages.privOwnerB}</p>

          <h2>{t.pages.privFavH}</h2>
          <p>
            {t.pages.privFavLead}
            <code>localStorage</code>
            {t.pages.privFavTail}
          </p>

          <h2>{t.pages.privMapsH}</h2>
          <p>
            {t.pages.privMapsLead} <strong>OpenStreetMap / CARTO</strong>{" "}
            {t.pages.privMapsTail}
          </p>

          {platforms.length > 0 && (
            <>
              <h2>{t.pages.privTrackH}</h2>
              <p>{t.pages.privTrackLead}</p>
              <ul>
                {platforms.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
              <p>{t.pages.privTrackBody}</p>
              <p>{t.pages.privTrackOptOut}</p>
            </>
          )}

          <h2>{t.pages.privRetainH}</h2>
          <p>{t.pages.privRetainB}</p>

          <h2>{t.pages.privRightsH}</h2>
          <p>
            {t.pages.privRightsLead}{" "}
            {settings.email ? (
              <a href={`mailto:${settings.email}`} dir="ltr">
                {settings.email}
              </a>
            ) : (
              <span dir="ltr">{settings.whatsappNumber}</span>
            )}{" "}
            {t.pages.privRightsTail}
          </p>
        </Prose>
      </div>
    </>
  );
}
