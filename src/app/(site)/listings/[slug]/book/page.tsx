import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { BookingForm } from "@/components/booking/booking-form";
import { Icon } from "@/components/ui/icon";
import { getListingBySlug, isRangeAvailable } from "@/lib/listings";
import { getSettings } from "@/lib/settings";
import { quote } from "@/lib/pricing";
import { cityLabel } from "@/lib/constants";
import { arNum, arRating } from "@/lib/format";
import { arDayMonth, isISODate, todayISO } from "@/lib/dates";

export const metadata: Metadata = {
  title: "إرسال طلب حجز",
  // A per-guest form has nothing to offer search; keep it out of the index and
  // don't leak query params into crawled URLs.
  robots: { index: false, follow: true },
};

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);

  const listing = await getListingBySlug(decodeURIComponent(slug));
  if (!listing) notFound();

  const from = typeof sp.from === "string" ? sp.from : undefined;
  const to = typeof sp.to === "string" ? sp.to : undefined;
  const guestsRaw = Number(typeof sp.guests === "string" ? sp.guests : "");

  /**
   * Arriving here without a usable range means the visitor deep-linked or the
   * dates expired. Send them to the calendar rather than rendering a form that
   * can only fail — the calendar is where the decision actually gets made.
   */
  const detailUrl = `/listings/${encodeURIComponent(listing.slug)}#availability`;
  if (!isISODate(from) || !isISODate(to) || from! >= to! || from! < todayISO()) {
    redirect(detailUrl);
  }

  // Someone else may have taken the dates between the detail page and here.
  const stillFree = await isRangeAvailable(listing.id, from!, to!);
  if (!stillFree) {
    redirect(`${detailUrl}?unavailable=1`);
  }

  const settings = await getSettings();
  const guests = Number.isFinite(guestsRaw) && guestsRaw > 0
    ? Math.min(guestsRaw, listing.capacity)
    : Math.min(listing.capacity, 20);

  const q = quote({
    checkIn: from!,
    checkOut: to!,
    pricePerNight: listing.pricePerNight,
    weekendPrice: listing.weekendPrice,
    serviceFeePercent: settings.serviceFeePercent,
    depositPercent: settings.depositPercent,
  });

  const where = listing.area || cityLabel(listing.city);

  return (
    <div className="min-h-[70vh] bg-sand-50">
      <div className="mx-auto max-w-[1060px] px-4 pt-6 pb-18 md:px-10">
        <nav
          aria-label="مسار التنقل"
          className="mb-4 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted"
        >
          <Link
            href={`/listings/${encodeURIComponent(listing.slug)}`}
            className="text-muted no-underline hover:text-bronze hover:no-underline"
          >
            {listing.name}
          </Link>
          <Icon name="chevron_left" size={15} />
          <span className="font-semibold text-ink">طلب حجز</span>
        </nav>

        <h1 className="m-0 mb-2 font-display text-[clamp(22px,2.8vw,32px)] font-extrabold text-ink">
          إرسال طلب حجز
        </h1>
        <p className="m-0 mb-6.5 max-w-[56ch] text-[15px] text-muted">
          املأ البيانات التالية وسيصل الطلب مباشرة إلى مالك الاستراحة على الواتساب. لا يُخصم أي
          مبلغ في هذه المرحلة.
        </p>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <BookingForm
            listingId={listing.id}
            listingSlug={listing.slug}
            checkIn={from!}
            checkOut={to!}
            guests={guests}
            capacity={listing.capacity}
            freeCancelHours={settings.freeCancelHours}
            depositPercent={settings.depositPercent}
          />

          {/* ---- summary ---- */}
          <aside className="rounded-[28px] border border-line bg-surface p-5 shadow-e1 lg:sticky lg:top-[150px] lg:border-sand-300 lg:shadow-e2">
            <div className="mb-4 flex gap-3">
              <div className="relative size-17.5 shrink-0 overflow-hidden rounded-[13px] bg-sand-200">
                {listing.coverUrl && (
                  <Image
                    src={listing.coverUrl}
                    alt=""
                    fill
                    sizes="88px"
                    className="object-cover"
                  />
                )}
              </div>
              <div className="min-w-0">
                <h2 className="m-0 mb-1 font-display text-[15px] font-bold leading-snug text-ink">
                  {listing.name}
                </h2>
                <div className="flex items-center gap-1 text-[12.5px] text-muted">
                  <Icon name="location_on" size={15} />
                  {where}
                </div>
                {listing.reviewsCount > 0 && (
                  <div className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-bold text-ink">
                    <Icon name="star" size={14} className="text-gold-500" />
                    {arRating(listing.rating)}
                  </div>
                )}
              </div>
            </div>

            <div className="mb-3.5 h-px bg-line" />

            <SummaryRow
              label="التواريخ"
              value={`${arDayMonth(from!)} – ${arDayMonth(to!)}`}
            />
            <SummaryRow
              label={`${arNum(listing.pricePerNight)} د.إ × ${arNum(q.nights)} ليلة`}
              value={arNum(q.subtotal)}
            />
            <SummaryRow
              label={`رسوم الخدمة (${arNum(settings.serviceFeePercent)}٪)`}
              value={arNum(q.serviceFee)}
              muted
            />
            <SummaryRow label="عدد الضيوف" value={arNum(guests)} muted />

            <div className="mt-3 flex justify-between border-t border-dashed border-line pt-3 font-display text-[17px] font-extrabold text-ink">
              <span>الإجمالي التقديري</span>
              <span>{arNum(q.total)} د.إ</span>
            </div>

            <p className="m-0 mt-2 text-[11.5px] text-muted">
              العربون المتوقع {arNum(q.depositDue)} د.إ ({arNum(settings.depositPercent)}٪) — يُدفع
              للمالك بعد التأكيد.
            </p>

            {/* Payment stub: the flow is shaped for an online deposit, but no
                gateway is wired. See src/lib/payments/index.ts. */}
            <div className="mt-3.5 flex items-center gap-2 rounded-xl bg-ok-bg px-3 py-3 text-[12.5px] font-semibold text-ok">
              <Icon name="lock" size={18} />
              لا يُطلب أي دفع عبر الموقع
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={`mb-2.5 flex justify-between gap-2 text-[13.5px] ${
        muted ? "text-muted" : "text-ink"
      }`}
    >
      <span>{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}
