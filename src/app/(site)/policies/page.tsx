import type { Metadata } from "next";
import { PageHeader, Prose } from "@/components/site/page-shell";
import { getSettings } from "@/lib/settings";
import { arNum } from "@/lib/format";

export const metadata: Metadata = {
  title: "سياسة الحجز والإلغاء",
  description: "شروط الحجز، العربون، الإلغاء، وقواعد استخدام الاستراحات.",
  alternates: { canonical: "/policies" },
};

/**
 * Booking terms.
 *
 * The percentages and hours are read from settings rather than written into the
 * copy, so changing the deposit in /admin/settings updates the published terms
 * too — otherwise the terms page silently starts contradicting the checkout.
 */
export default async function PoliciesPage() {
  const settings = await getSettings();

  return (
    <>
      <PageHeader
        title="سياسة الحجز والإلغاء"
        subtitle="القواعد التي يعمل بها الموقع بين الضيف والمالك."
      />

      <div className="mx-auto max-w-[900px] px-4 py-10 md:px-10 md:py-14">
        <Prose>
          <h2>١. طبيعة الخدمة</h2>
          <p>
            {settings.siteName} منصّة وسيطة تعرض استراحات وشاليهات مملوكة لأطراف مستقلّين. عقد
            الإقامة يقوم بينك وبين مالك الاستراحة. دورنا هو التحقّق من العروض، عرض التوفّر والسعر
            بدقّة، وتوصيل طلبك للمالك.
          </p>

          <h2>٢. الطلب والتأكيد</h2>
          <p>
            إرسال الطلب من الموقع <strong>ليس حجزًا مؤكدًا</strong>. يصبح الحجز مؤكدًا فقط بعد أن
            يوافق المالك عليه ويُغلق التقويم على تواريخك. حتى تلك اللحظة قد تُحجز التواريخ لضيف آخر.
          </p>

          <h2>٣. الأسعار ورسوم الخدمة</h2>
          <ul>
            <li>الأسعار بالدرهم الإماراتي وتشمل رسوم خدمة بنسبة {arNum(settings.serviceFeePercent)}٪.</li>
            <li>سعر الجمعة والسبت قد يكون أعلى، ويظهر بوضوح في التقويم قبل الإرسال.</li>
            <li>لا توجد رسوم إضافية تُضاف بعد عرض الإجمالي.</li>
          </ul>

          <h2>٤. العربون</h2>
          <p>
            يُستحق عربون بنسبة {arNum(settings.depositPercent)}٪ من الإجمالي بعد تأكيد المالك، وليس
            عند إرسال الطلب. لا يُحصَّل أي مبلغ عبر الموقع؛ طريقة الدفع يحدّدها المالك عند التواصل.
          </p>

          <h2>٥. الإلغاء</h2>
          <ul>
            <li>
              الإلغاء مجاني حتى <strong>{arNum(settings.freeCancelHours)} ساعة</strong> قبل موعد
              الوصول، ويُرد العربون كاملًا.
            </li>
            <li>الإلغاء بعد هذه المدة يخضع لسياسة المالك المذكورة في صفحة الاستراحة.</li>
            <li>عدم الحضور دون إشعار يُعامل كإلغاء متأخر.</li>
            <li>إذا ألغى المالك حجزًا مؤكدًا، يُرد العربون كاملًا ونساعدك في إيجاد بديل.</li>
          </ul>

          <h2>٦. مواعيد الدخول والخروج</h2>
          <p>
            الدخول من {settings.checkInTime} والخروج حتى {settings.checkOutTime}، ما لم يُتفق على
            غير ذلك مع المالك.
          </p>

          <h2>٧. قواعد الاستخدام</h2>
          <ul>
            <li>عدد الضيوف لا يتجاوز السعة المعلنة.</li>
            <li>احترام هدوء المنطقة وأوقات الراحة.</li>
            <li>الأضرار التي تلحق بالممتلكات مسؤولية الضيف.</li>
            <li>يُمنع أي استخدام مخالف لقوانين دولة الإمارات العربية المتحدة.</li>
          </ul>

          <h2>٨. الشكاوى</h2>
          <p>
            إن اختلف الواقع عمّا هو معروض، راسلنا على الواتساب{" "}
            <span dir="ltr">{settings.whatsappNumber}</span> مع رقم طلبك خلال ٢٤ ساعة من الوصول
            ونتدخّل مباشرة.
          </p>
        </Prose>
      </div>
    </>
  );
}
