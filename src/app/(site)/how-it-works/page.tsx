import type { Metadata } from "next";
import { Icon, type IconName } from "@/components/ui/icon";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/site/page-shell";
import { getSettings, absoluteUrl } from "@/lib/settings";
import { arNum } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";
import { htmlLang } from "@/lib/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t.pages.howTitle,
    description: t.pages.howDescription,
    alternates: { canonical: "/how-it-works" },
  };
}

export default async function HowItWorksPage() {
  const [settings, { t, locale }] = await Promise.all([getSettings(), getI18n()]);

  const steps: { icon: IconName; title: string; body: string }[] = [
    { icon: "search", title: t.pages.howStep1Title, body: t.pages.howStep1Body },
    { icon: "calendar_today", title: t.pages.howStep2Title, body: t.pages.howStep2Body },
    { icon: "send", title: t.pages.howStep3Title, body: t.pages.howStep3Body },
    // The deposit is no longer quoted as a single platform figure here: each
    // owner sets their own, so the step points at the rest house's own page
    // rather than naming a number that may not apply.
    { icon: "verified", title: t.pages.howStep4Title, body: t.pages.howStep4Body },
  ];

  /** HowTo structured data — can surface as a step-by-step rich result. */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: t.pages.howJsonLdName,
    inLanguage: `${htmlLang(locale)}-AE`,
    url: absoluteUrl("/how-it-works"),
    step: steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.title,
      text: s.body,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <PageHeader title={t.pages.howTitle} subtitle={t.pages.howSubtitle} />

      <div className="mx-auto max-w-[900px] px-4 py-10 md:px-10 md:py-14">
        <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
          {steps.map((step, i) => (
            <li
              key={step.title}
              className="flex gap-4 rounded-[20px] border border-line bg-surface p-4.5 shadow-e1 md:p-5"
            >
              <div className="flex shrink-0 flex-col items-center gap-2">
                <span className="grid size-11 place-items-center rounded-[13px] bg-gold-100 font-display text-[17px] font-extrabold text-bronze">
                  {arNum(i + 1, locale)}
                </span>
                {i < steps.length - 1 && <span className="w-px flex-1 bg-line" aria-hidden />}
              </div>
              <div>
                <h2 className="m-0 mb-1.5 flex items-center gap-2 font-display text-[17px] font-bold text-ink">
                  <Icon name={step.icon} size={20} className="text-gold-600" />
                  {step.title}
                </h2>
                <p className="m-0 text-[14.5px] leading-[1.9] text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-8 rounded-[20px] border border-line bg-gold-100/60 p-5">
          <h2 className="m-0 mb-2 flex items-center gap-2 font-display text-[16px] font-extrabold text-bronze">
            <Icon name="policy" size={19} />
            {t.pages.howCancelTitle}
          </h2>
          <p className="m-0 text-[14px] leading-[1.9] text-bronze">
            {t.pages.howCancelBody(arNum(settings.freeCancelHours, locale))}
          </p>
        </div>

        <div className="mt-6">
          <ButtonLink href="/listings" size="lg">
            {t.pages.howStartSearch}
          </ButtonLink>
        </div>
      </div>
    </>
  );
}
