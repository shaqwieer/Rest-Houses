import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { ButtonLink } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { getSettings, absoluteUrl } from "@/lib/settings";
import { bookingRequestMessage, whatsappLink } from "@/lib/whatsapp";
import { isDepositPaymentEnabled } from "@/lib/payments";
import { arDayMonth } from "@/lib/dates";
import { arNum, toArabicDigits } from "@/lib/format";

export const metadata: Metadata = {
  title: "تم إرسال الطلب",
  robots: { index: false, follow: false },
};

/**
 * Booking confirmation — and the page that builds the WhatsApp deep link.
 *
 * The link is assembled *here*, server-side, after the request exists, which is
 * the whole reason the flow is split across two pages:
 *   • the message can quote the real reference number (RQ-2420)
 *   • the totals in the message are the stored snapshot, not a form value
 *   • the owner has a database record even if the guest never presses send
 *
 * `wa.me?text=` pre-types the message but does not send it — the guest taps
 * send themselves.
 */
export default async function BookingConfirmationPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;

  const booking = await prisma.bookingRequest.findUnique({
    where: { reference: decodeURIComponent(reference) },
    include: {
      listing: {
        select: {
          name: true,
          slug: true,
          area: true,
          ownerName: true,
          ownerWhatsapp: true,
        },
      },
    },
  });

  if (!booking) notFound();

  const settings = await getSettings();

  // Per-listing owner number wins; otherwise the site-wide number from settings.
  const targetNumber = booking.listing.ownerWhatsapp || settings.whatsappNumber;

  const message = bookingRequestMessage({
    siteName: settings.siteName,
    reference: booking.reference,
    listingName: booking.listing.name,
    listingArea: booking.listing.area,
    listingUrl: absoluteUrl(`/listings/${encodeURIComponent(booking.listing.slug)}`),
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    nights: booking.nights,
    guests: booking.guests,
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    total: booking.total,
    notes: booking.notes,
  });

  const waHref = whatsappLink(targetNumber, message);
  const depositEnabled = isDepositPaymentEnabled(settings);

  return (
    <div className="min-h-[70vh] bg-sand-50">
      <div className="animate-pop-in mx-auto max-w-[620px] px-4 py-10 text-center md:py-15">
        <div className="mx-auto mb-6 grid size-24 place-items-center rounded-full border-2 border-ok/25 bg-ok-bg">
          <Icon name="check_circle" size={52} className="text-ok" />
        </div>

        <h1 className="m-0 mb-3 font-display text-[clamp(23px,3vw,32px)] font-extrabold text-ink">
          تم إرسال طلبك بنجاح
        </h1>
        <p className="m-0 mb-2 text-[15.5px] leading-[1.9] text-muted">
          وصل طلبك إلى مالك{" "}
          <strong className="text-ink">{booking.listing.name}</strong>. اضغط الزر أدناه لفتح
          المحادثة وإرسال التفاصيل — الرسالة جاهزة، يبقى الضغط على «إرسال».
        </p>

        <div className="my-4 inline-flex items-center gap-2.5 rounded-full bg-gold-100 px-5 py-2.5 text-[14px] font-bold text-bronze">
          <Icon name="confirmation_number" size={19} />
          رقم الطلب: <span dir="ltr">{toArabicDigits(booking.reference)}</span>
        </div>

        {/* ---- summary ---- */}
        <div className="mb-5.5 rounded-[28px] border border-line bg-surface p-5.5 text-start shadow-e1">
          <h2 className="m-0 mb-4 font-display text-[16px] font-extrabold text-ink">ملخص الطلب</h2>
          <Row label="الاستراحة" value={booking.listing.name} />
          <Row
            label="التواريخ"
            value={`${arDayMonth(booking.checkIn)} – ${arDayMonth(booking.checkOut)}`}
          />
          <Row label="عدد الليالي" value={arNum(booking.nights)} />
          <Row label="الضيوف" value={arNum(booking.guests)} />
          <Row label="مقدّم الطلب" value={booking.customerName} />
          <Row
            label="الإجمالي التقديري"
            value={`${arNum(booking.total)} د.إ`}
            emphasis
            last
          />
        </div>

        {/* ---- deposit: disabled stub ----
            When an online-deposit gateway is enabled from /admin/settings this
            block becomes the "pay now" step. Until then it states plainly how
            the deposit is collected. */}
        <div className="mb-5.5 flex items-start gap-3 rounded-2xl border border-line bg-sand-100 p-4 text-start">
          <Icon name="savings" size={20} className="shrink-0 text-bronze" />
          <p className="m-0 text-[12.5px] leading-[1.8] text-muted">
            {depositEnabled ? (
              <>يمكنك دفع العربون ({arNum(booking.depositDue)} د.إ) إلكترونيًا بعد تأكيد المالك.</>
            ) : (
              <>
                العربون المتوقع <strong className="text-ink">{arNum(booking.depositDue)} د.إ</strong>{" "}
                ويُحصَّل مباشرة من المالك بعد تأكيد التوفّر — لا يوجد دفع إلكتروني على الموقع حاليًا.
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2.5">
          <ButtonLink href={waHref} variant="whatsapp" size="lg">
            <Icon name="chat" size={20} />
            فتح المحادثة الآن
          </ButtonLink>
          <ButtonLink href="/listings" variant="secondary" size="lg">
            تصفّح استراحات أخرى
          </ButtonLink>
        </div>

        <p className="m-0 mt-5 text-[12px] text-muted">
          احتفظ برقم الطلب <span dir="ltr">{toArabicDigits(booking.reference)}</span> للمراجعة.
          {settings.email && (
            <>
              {" "}
              لأي استفسار:{" "}
              <Link href={`mailto:${settings.email}`} dir="ltr" className="text-bronze">
                {settings.email}
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
  last,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-3 py-2.5 text-[14px] text-muted ${
        last ? "" : "border-b border-dashed border-line"
      }`}
    >
      <span>{label}</span>
      <span
        className={
          emphasis
            ? "font-display text-[16px] font-extrabold text-ink"
            : "font-bold text-ink"
        }
      >
        {value}
      </span>
    </div>
  );
}
