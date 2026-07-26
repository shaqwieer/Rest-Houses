import type { Metadata } from "next";
import { Icon, type IconName } from "@/components/ui/icon";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/site/page-shell";
import { getSettings, absoluteUrl } from "@/lib/settings";
import { arNum } from "@/lib/format";

export const metadata: Metadata = {
  title: "كيف أحجز؟",
  description:
    "أربع خطوات لحجز استراحة: ابحث، اختر التواريخ من التقويم، أرسل الطلب، ثم أكّد مع المالك على الواتساب.",
  alternates: { canonical: "/how-it-works" },
};

export default async function HowItWorksPage() {
  const settings = await getSettings();

  const steps: { icon: IconName; title: string; body: string }[] = [
    {
      icon: "search",
      title: "ابحث وفلتِر",
      body: "حدّد الوجهة والتواريخ وعدد الضيوف، ثم ضيّق النتائج بالسعر والسعة والمرافق حتى تجد ما يناسبك.",
    },
    {
      icon: "calendar_today",
      title: "اختر التواريخ من التقويم",
      body: "الأيام المحجوزة تظهر مشطوبة ولا يمكن اختيارها. اختر الوصول ثم المغادرة، وسيُحسب الإجمالي فورًا شاملًا رسوم الخدمة.",
    },
    {
      icon: "send",
      title: "أرسل الطلب",
      body: "املأ اسمك ورقم جوالك وأي ملاحظات. يُسجَّل الطلب ويُعطى رقمًا، ثم يفتح لك الواتساب برسالة جاهزة تحتوي كل التفاصيل.",
    },
    {
      icon: "verified",
      title: "أكّد مع المالك",
      body: `يتواصل معك المالك لتأكيد التوفّر والعربون (${arNum(settings.depositPercent)}٪). لا يُخصم أي مبلغ عبر الموقع — الدفع يكون مباشرة معه.`,
    },
  ];

  /** HowTo structured data — can surface as a step-by-step rich result. */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "كيف أحجز استراحة",
    inLanguage: "ar-AE",
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

      <PageHeader
        title="كيف أحجز؟"
        subtitle="أربع خطوات من البحث حتى التأكيد — بلا تسجيل حساب وبلا دفع إلكتروني."
      />

      <div className="mx-auto max-w-[900px] px-4 py-10 md:px-10 md:py-14">
        <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
          {steps.map((step, i) => (
            <li
              key={step.title}
              className="flex gap-4 rounded-[20px] border border-line bg-surface p-4.5 shadow-e1 md:p-5"
            >
              <div className="flex shrink-0 flex-col items-center gap-2">
                <span className="grid size-11 place-items-center rounded-[13px] bg-gold-100 font-display text-[17px] font-extrabold text-bronze">
                  {arNum(i + 1)}
                </span>
                {i < steps.length - 1 && (
                  <span className="w-px flex-1 bg-line" aria-hidden />
                )}
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
            الإلغاء
          </h2>
          <p className="m-0 text-[14px] leading-[1.9] text-bronze">
            الإلغاء مجاني حتى {arNum(settings.freeCancelHours)} ساعة قبل موعد الوصول. بعد ذلك يخضع
            العربون لسياسة المالك المذكورة في صفحة الاستراحة.
          </p>
        </div>

        <div className="mt-6">
          <ButtonLink href="/listings" size="lg">
            ابدأ البحث
          </ButtonLink>
        </div>
      </div>
    </>
  );
}
