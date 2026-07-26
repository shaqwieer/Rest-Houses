import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { ButtonLink } from "@/components/ui/button";
import { getSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { arNum } from "@/lib/format";
import { generalEnquiryMessage, whatsappLink } from "@/lib/whatsapp";
import { PageHeader, Prose } from "@/components/site/page-shell";

/**
 * Rendered per request: this page reads the database, and the container image is
 * built without one. See the note on the home page for the full reasoning.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: "من نحن",
    description: settings.footerAbout,
    alternates: { canonical: "/about" },
  };
}

export default async function AboutPage() {
  const settings = await getSettings();
  const [listingCount, bookingCount] = await Promise.all([
    prisma.listing.count({ where: { published: true } }),
    prisma.bookingRequest.count({ where: { status: "CONFIRMED" } }),
  ]);

  return (
    <>
      <PageHeader title="من نحن" subtitle={settings.footerAbout} />

      <div className="mx-auto max-w-[900px] px-4 pb-16 md:px-10">
        <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat value={arNum(listingCount)} label="استراحة منشورة" icon="holiday_village" />
          <Stat value={arNum(bookingCount)} label="حجز مؤكد" icon="task_alt" />
          <Stat value="٥" label="إمارات مغطّاة" icon="location_on" />
        </div>

        <Prose>
          <h2>لماذا بدأنا</h2>
          <p>
            حجز استراحة في الإمارات كان يعني عشرات المكالمات، صورًا قديمة لا تشبه المكان، وأسعارًا
            تتغيّر عند الوصول. أنشأنا {settings.siteName} لتكون الوسيط الذي يحلّ هذه المشكلة: كل
            استراحة معروضة هنا زارها فريقنا، وصوّرها كما هي، ونشر سعرها وسياستها بوضوح قبل أن تسأل.
          </p>

          <h2>كيف نتحقّق</h2>
          <p>
            قبل نشر أي استراحة نزورها ميدانيًا، نتحقّق من المساحة والسعة الفعلية، ونصوّر المرافق
            المذكورة واحدًا واحدًا. الاستراحة التي تحمل شارة «موثّقة» مرّت بهذه الخطوة. أي فرق بين
            الوصف والواقع يُبلَّغ عنه ونتدخّل فيه مباشرة.
          </p>

          <h2>كيف نكسب</h2>
          <p>
            لا نطلب أي دفع عبر الموقع. تُرسل طلبك، فيصل المالك مباشرة على الواتساب بكل التفاصيل
            جاهزة، ويتم الاتفاق والدفع بينكما. نحصل على رسوم خدمة بنسبة{" "}
            {arNum(settings.serviceFeePercent)}٪ مضمّنة في السعر المعروض — لا رسوم مخفية تُضاف
            لاحقًا.
          </p>

          <h2>للمُلّاك</h2>
          <p>
            إذا كنت تملك استراحة وتريد إضافتها، راسلنا على الواتساب. ستحصل على لوحة تحكم من جوّالك
            تديرين منها الأسعار، التقويم، وطلبات الحجز.
          </p>
        </Prose>

        <div className="mt-8 flex flex-wrap gap-2.5">
          <ButtonLink
            href={whatsappLink(settings.whatsappNumber, generalEnquiryMessage(settings.siteName))}
            variant="whatsapp"
            size="lg"
          >
            <Icon name="chat" size={20} />
            راسلنا على الواتساب
          </ButtonLink>
          <ButtonLink href="/listings" variant="secondary" size="lg">
            تصفّح الاستراحات
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
