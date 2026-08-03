import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { ButtonLink } from "@/components/ui/button";
import { getSettings, localizeSettings } from "@/lib/settings";
import { getPublicListingStats } from "@/lib/listings";
import { prisma } from "@/lib/prisma";
import { arNum } from "@/lib/format";
import { generalEnquiryMessage, whatsappLink } from "@/lib/whatsapp";
import { PageHeader, Prose } from "@/components/site/page-shell";
import { getI18n } from "@/lib/i18n/server";

/**
 * Rendered per request: this page reads the database, and the container image is
 * built without one. See the note on the home page for the full reasoning.
 *
 * ─── Copy ────────────────────────────────────────────────────────────────────
 * The "for owners" section that used to close this page has been dropped. It
 * addressed owners on a page a customer reads, and it pointed them at a WhatsApp
 * conversation that is no longer how an owner joins — registration is now a form
 * at /register/owner, linked from the footer and the mobile menu, which is where
 * owner-facing copy belongs (requirement 6).
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const [{ t, locale }, settings] = await Promise.all([getI18n(), getSettings()]);
  const s = localizeSettings(settings, locale);
  return {
    title: t.pages.aboutTitle,
    description: s.footerAbout,
    alternates: { canonical: "/about" },
  };
}

export default async function AboutPage() {
  const [settings, { t, locale }, stats, bookingCount] = await Promise.all([
    getSettings(),
    getI18n(),
    // The same gated stats the home page uses, so the count on this page can't
    // advertise listings the catalogue is hiding.
    getPublicListingStats(),
    prisma.bookingRequest.count({ where: { status: "CONFIRMED" } }),
  ]);

  const s = localizeSettings(settings, locale);
  const waHref = whatsappLink(
    settings.whatsappNumber,
    generalEnquiryMessage(s.siteName, locale),
  );

  return (
    <>
      <PageHeader title={t.pages.aboutTitle} subtitle={s.footerAbout} />

      <div className="mx-auto max-w-[900px] px-4 pb-16 md:px-10">
        <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat
            value={arNum(stats.total, locale)}
            label={t.pages.aboutStatListings}
            icon="holiday_village"
          />
          <Stat
            value={arNum(bookingCount, locale)}
            label={t.pages.aboutStatBookings}
            icon="task_alt"
          />
          <Stat
            value={arNum(stats.cities, locale)}
            label={t.pages.aboutStatEmirates}
            icon="location_on"
          />
        </div>

        <Prose>
          <h2>{t.pages.aboutWhyTitle}</h2>
          <p>{t.pages.aboutWhyBody(s.siteName)}</p>

          <h2>{t.pages.aboutVerifyTitle}</h2>
          <p>{t.pages.aboutVerifyBody}</p>

          <h2>{t.pages.aboutEarnTitle}</h2>
          {/* Two paragraphs, not one with a number substituted: at 0% the
              honest sentence is "we add no service fee", not "we charge a 0%
              service fee". */}
          <p>
            {settings.serviceFeePercent > 0
              ? t.pages.aboutEarnBody(arNum(settings.serviceFeePercent, locale))
              : t.pages.aboutEarnBodyNoFee}
          </p>
        </Prose>

        <div className="mt-8 flex flex-wrap gap-2.5">
          {waHref && (
            <ButtonLink href={waHref} variant="whatsapp" size="lg">
              <Icon name="chat" size={20} />
              {t.pages.aboutContactWhatsapp}
            </ButtonLink>
          )}
          <ButtonLink href="/listings" variant="secondary" size="lg">
            {t.common.browse}
          </ButtonLink>
        </div>
      </div>
    </>
  );
}

function Stat({
  value,
  label,
  icon,
}: {
  value: string;
  label: string;
  icon: "holiday_village" | "task_alt" | "location_on";
}) {
  return (
    <div className="rounded-[20px] border border-line bg-surface p-4 text-center shadow-e1">
      <Icon name={icon} size={24} className="mx-auto mb-2 text-gold-600" />
      <div className="font-display text-[24px] font-extrabold text-ink">{value}</div>
      <div className="text-[12px] text-muted">{label}</div>
    </div>
  );
}
