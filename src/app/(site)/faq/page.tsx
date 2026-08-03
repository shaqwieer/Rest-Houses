import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/site/page-shell";
import { getSettings, absoluteUrl, localizeSettings } from "@/lib/settings";
import { arNum } from "@/lib/format";
import { generalEnquiryMessage, whatsappLink } from "@/lib/whatsapp";
import { getI18n } from "@/lib/i18n/server";
import { htmlLang } from "@/lib/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t.pages.faqTitle,
    description: t.pages.faqDescription,
    alternates: { canonical: "/faq" },
  };
}

export default async function FaqPage() {
  const [settings, { t, locale }] = await Promise.all([getSettings(), getI18n()]);
  const s = localizeSettings(settings, locale);

  /**
   * The deposit answer names the platform default *and* says explicitly that
   * each owner sets their own. The old copy quoted the platform figure as
   * though it were the only one, which stopped being true the moment owners
   * could set a rate per listing.
   */
  const faqs = [
    { q: t.pages.faqQ1, a: t.pages.faqA1 },
    { q: t.pages.faqQ2, a: t.pages.faqA2(arNum(settings.depositPercent, locale)) },
    { q: t.pages.faqQ3, a: t.pages.faqA3(arNum(settings.freeCancelHours, locale)) },
    // "Are the prices final?" stays in the list either way — it is the question
    // removing the fee makes *more* worth answering, not less. Only the answer
    // changes.
    {
      q: t.pages.faqQ4,
      a:
        settings.serviceFeePercent > 0
          ? t.pages.faqA4(arNum(settings.serviceFeePercent, locale))
          : t.pages.faqA4NoFee,
    },
    { q: t.pages.faqQ5, a: t.pages.faqA5 },
    { q: t.pages.faqQ6, a: t.pages.faqA6 },
    { q: t.pages.faqQ7, a: t.pages.faqA7 },
    { q: t.pages.faqQ8, a: t.pages.faqA8 },
  ];

  /** FAQPage structured data — eligible for the expandable FAQ rich result. */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: `${htmlLang(locale)}-AE`,
    url: absoluteUrl("/faq"),
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  const waHref = whatsappLink(
    settings.whatsappNumber,
    generalEnquiryMessage(s.siteName, locale),
  );

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <PageHeader title={t.pages.faqTitle} subtitle={t.pages.faqSubtitle} />

      <div className="mx-auto max-w-[820px] px-4 py-10 md:px-10 md:py-14">
        <div className="flex flex-col gap-2.5">
          {faqs.map((faq) => (
            // <details> gives working accordion behaviour with zero JS, and stays
            // expandable for crawlers and screen readers alike.
            <details
              key={faq.q}
              className="group rounded-[20px] border border-line bg-surface px-4.5 py-4 shadow-e1 open:border-gold-500"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-display text-[15.5px] font-bold text-ink [&::-webkit-details-marker]:hidden">
                {faq.q}
                <Icon
                  name="expand_more"
                  size={22}
                  className="shrink-0 text-bronze transition group-open:rotate-180"
                />
              </summary>
              <p className="mt-3 mb-0 border-t border-line pt-3 text-[14.5px] leading-[1.95] text-muted">
                {faq.a}
              </p>
            </details>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-2.5">
          {waHref && (
            <ButtonLink href={waHref} variant="whatsapp" size="lg">
              <Icon name="chat" size={20} />
              {t.pages.faqAskWhatsapp}
            </ButtonLink>
          )}
          <ButtonLink href="/how-it-works" variant="secondary" size="lg">
            {t.nav.howItWorks}
          </ButtonLink>
        </div>
      </div>
    </>
  );
}
