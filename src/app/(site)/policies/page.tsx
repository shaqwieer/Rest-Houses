import type { Metadata } from "next";
import { PageHeader, Prose } from "@/components/site/page-shell";
import { getSettings, localizeSettings } from "@/lib/settings";
import { arNum } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t.pages.policiesTitle,
    description: t.pages.policiesDescription,
    alternates: { canonical: "/policies" },
  };
}

/**
 * Booking terms.
 *
 * The percentages and hours are read from settings rather than written into the
 * copy, so changing the service fee in /admin/settings updates the published
 * terms too — otherwise the terms page silently starts contradicting checkout.
 *
 * The deposit clause is the one exception, and deliberately so: since owners set
 * their own rate per listing, no single number here could be correct for every
 * rest house. It names the platform *default* and points the reader at the
 * listing's own page, which is where the figure that will actually be charged
 * is shown.
 */
export default async function PoliciesPage() {
  const [settings, { t, locale }] = await Promise.all([getSettings(), getI18n()]);
  const s = localizeSettings(settings, locale);

  return (
    <>
      <PageHeader title={t.pages.policiesTitle} subtitle={t.pages.policiesSubtitle} />

      <div className="mx-auto max-w-[900px] px-4 py-10 md:px-10 md:py-14">
        <Prose>
          <h2>{t.pages.polS1H}</h2>
          <p>{t.pages.polS1B(s.siteName)}</p>

          <h2>{t.pages.polS2H}</h2>
          <p>
            {t.pages.polS2Lead} <strong>{t.pages.polS2Strong}</strong>
            {t.pages.polS2Tail}
          </p>

          <h2>{t.pages.polS3H}</h2>
          <ul>
            <li>
              {settings.serviceFeePercent > 0
                ? t.pages.polS3L1(arNum(settings.serviceFeePercent, locale))
                : t.pages.polS3L1NoFee}
            </li>
            <li>{t.pages.polS3L2}</li>
            <li>{t.pages.polS3L3}</li>
          </ul>

          <h2>{t.pages.polS4H}</h2>
          <p>{t.pages.polS4B(arNum(settings.depositPercent, locale))}</p>

          <h2>{t.pages.polS5H}</h2>
          <ul>
            <li>
              {t.pages.polS5L1a}{" "}
              <strong>{t.pages.polS5L1b(arNum(settings.freeCancelHours, locale))}</strong>{" "}
              {t.pages.polS5L1c}
            </li>
            <li>{t.pages.polS5L2}</li>
            <li>{t.pages.polS5L3}</li>
            <li>{t.pages.polS5L4}</li>
          </ul>

          <h2>{t.pages.polS6H}</h2>
          <p>{t.pages.polS6B(s.checkInTime, s.checkOutTime)}</p>

          <h2>{t.pages.polS7H}</h2>
          <ul>
            <li>{t.pages.polS7L1}</li>
            <li>{t.pages.polS7L2}</li>
            <li>{t.pages.polS7L3}</li>
            <li>{t.pages.polS7L4}</li>
          </ul>

          <h2>{t.pages.polS8H}</h2>
          <p>
            {t.pages.polS8Lead} <span dir="ltr">{settings.whatsappNumber}</span>{" "}
            {t.pages.polS8Tail}
          </p>
        </Prose>
      </div>
    </>
  );
}
