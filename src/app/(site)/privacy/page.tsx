import type { Metadata } from "next";
import { PageHeader, Prose } from "@/components/site/page-shell";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "سياسة الخصوصية",
  description: "ما نجمعه من بيانات، لماذا، ومع من نشاركه.",
  alternates: { canonical: "/privacy" },
};

/**
 * Privacy policy. Describes what this codebase actually does — the booking form
 * fields, the localStorage favourites, the map tile provider — rather than
 * boilerplate that would be inaccurate.
 */
export default async function PrivacyPage() {
  const settings = await getSettings();

  return (
    <>
      <PageHeader
        title="سياسة الخصوصية"
        subtitle="نجمع أقل ما يلزم لإتمام الحجز، ولا نبيع بياناتك."
      />

      <div className="mx-auto max-w-[900px] px-4 py-10 md:px-10 md:py-14">
        <Prose>
          <h2>ما نجمعه</h2>
          <p>عند إرسال طلب حجز نحفظ فقط:</p>
          <ul>
            <li>الاسم ورقم الجوال (والبريد الإلكتروني إن أدخلته).</li>
            <li>تواريخ الإقامة وعدد الضيوف والاستراحة المطلوبة.</li>
            <li>الملاحظات التي تكتبها بنفسك.</li>
          </ul>
          <p>
            لا نطلب بيانات بطاقات بنكية ولا نخزّنها، لأن الدفع لا يمرّ عبر الموقع إطلاقًا.
          </p>

          <h2>لماذا نجمعها</h2>
          <p>
            لغرض واحد: توصيل طلبك إلى مالك الاستراحة وتمكينه من الرد عليك. تُشارك بياناتك مع مالك
            الاستراحة المعنيّة فقط، ولا تُشارك مع أي طرف آخر ولا تُباع لأي جهة.
          </p>

          <h2>المفضلة</h2>
          <p>
            قائمة المفضلة تُحفظ في ذاكرة متصفّحك (<code>localStorage</code>) على جهازك، ولا تُرسل
            إلى الخادم. حذف بيانات المتصفّح يمحوها.
          </p>

          <h2>الخرائط والصور</h2>
          <p>
            نستخدم خرائط <strong>OpenStreetMap / CARTO</strong> لعرض مواقع الاستراحات، و
            <strong> خرائط جوجل</strong> لموقعنا في أسفل الصفحة. تحميل الخرائط يعني أن مزوّدها يرى
            عنوان IP الخاص بك، وفق سياسة الخصوصية الخاصة به.
          </p>

          <h2>مدة الحفظ</h2>
          <p>
            نحفظ طلبات الحجز ما دامت لازمة لإدارة الحجز والرجوع إليه عند أي خلاف. يمكنك طلب حذف
            طلبك في أي وقت.
          </p>

          <h2>حقوقك</h2>
          <p>
            لك أن تطلب الوصول إلى بياناتك أو تصحيحها أو حذفها. راسلنا على{" "}
            {settings.email ? (
              <a href={`mailto:${settings.email}`} dir="ltr">
                {settings.email}
              </a>
            ) : (
              <span dir="ltr">{settings.whatsappNumber}</span>
            )}{" "}
            مع رقم الطلب.
          </p>
        </Prose>
      </div>
    </>
  );
}
