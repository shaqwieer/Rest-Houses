import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/site/page-shell";
import { getSettings, absoluteUrl } from "@/lib/settings";
import { arNum } from "@/lib/format";
import { generalEnquiryMessage, whatsappLink } from "@/lib/whatsapp";

export const metadata: Metadata = {
  title: "الأسئلة الشائعة",
  description:
    "أجوبة عن الدفع، الإلغاء، العربون، السعة، التوفّر، والوصول إلى الاستراحات الصحراوية في الإمارات.",
  alternates: { canonical: "/faq" },
};

export default async function FaqPage() {
  const settings = await getSettings();

  const faqs = [
    {
      q: "هل أدفع عبر الموقع؟",
      a: "لا. الموقع يسجّل طلبك ويوصله للمالك على الواتساب، والدفع يتم بينكما مباشرة. لا نطلب بطاقة ولا تحويلًا إلكترونيًا في أي مرحلة.",
    },
    {
      q: "كم العربون ومتى يُدفع؟",
      a: `العربون ${arNum(settings.depositPercent)}٪ من الإجمالي ويُستحق بعد أن يؤكّد المالك التوفّر — لا قبل ذلك. الطريقة يحدّدها المالك عند التواصل.`,
    },
    {
      q: "هل يمكنني الإلغاء؟",
      a: `الإلغاء مجاني حتى ${arNum(settings.freeCancelHours)} ساعة قبل موعد الوصول. بعد هذه المدة تُطبَّق سياسة المالك المذكورة في صفحة الاستراحة.`,
    },
    {
      q: "الأسعار المعروضة نهائية؟",
      a: `الإجمالي المعروض في صفحة الاستراحة يشمل سعر الليالي ورسوم الخدمة (${arNum(settings.serviceFeePercent)}٪). لا رسوم إضافية تُضاف بعد ذلك. سعر الجمعة والسبت قد يختلف ويظهر في التقويم.`,
    },
    {
      q: "هل التقويم دقيق؟",
      a: "نعم — الأيام المحجوزة أو المحظورة من المالك تظهر مشطوبة ولا يمكن اختيارها، ونتحقّق من التوفّر مرة أخرى في اللحظة التي ترسل فيها الطلب.",
    },
    {
      q: "ماذا لو تجاوز عدد ضيوفي السعة؟",
      a: "لا يقبل النظام طلبًا يتجاوز السعة المعلنة. إن كنت قريبًا من الحد الأقصى راسلنا على الواتساب ونبحث لك عن استراحة أوسع.",
    },
    {
      q: "متى أستلم الموقع الدقيق؟",
      a: "الخريطة في صفحة الاستراحة تُظهر المنطقة العامة. الموقع الدقيق ورمز البوابة يرسلهما المالك بعد تأكيد الحجز.",
    },
    {
      q: "أملك استراحة — كيف أضيفها؟",
      a: "راسلنا على الواتساب. بعد الزيارة الميدانية والتصوير نضيفها ونمنحك لوحة تحكم تدير منها الأسعار والتقويم والطلبات من جوّالك.",
    },
  ];

  /** FAQPage structured data — eligible for the expandable FAQ rich result. */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: "ar-AE",
    url: absoluteUrl("/faq"),
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <PageHeader
        title="الأسئلة الشائعة"
        subtitle="إن لم تجد جوابك هنا، راسلنا على الواتساب ونجيبك مباشرة."
      />

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
          <ButtonLink
            href={whatsappLink(settings.whatsappNumber, generalEnquiryMessage(settings.siteName))}
            variant="whatsapp"
            size="lg"
          >
            <Icon name="chat" size={20} />
            اسألنا على الواتساب
          </ButtonLink>
          <ButtonLink href="/how-it-works" variant="secondary" size="lg">
            كيف أحجز؟
          </ButtonLink>
        </div>
      </div>
    </>
  );
}
