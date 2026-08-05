import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { BookingForm } from "@/components/booking/booking-form";
import { Icon } from "@/components/ui/icon";
import { getListingBySlug, isRangeAvailable, localizeListing } from "@/lib/listings";
import { getSettings } from "@/lib/settings";
import { quote, resolveDepositPercent } from "@/lib/pricing";
import { cityLabel } from "@/lib/constants";
import { arNum, arRating } from "@/lib/format";
import { arDayMonth, isISODate, todayISO } from "@/lib/dates";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t.booking.title,
    // A per-guest form has nothing to offer search; keep it out of the index and
    // don't leak query params into crawled URLs.
    robots: { index: false, follow: true },
  };
}

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, sp, { t, locale }] = await Promise.all([params, searchParams, getI18n()]);

  // The public predicate applies here too: an inactive owner's listing is not
  // bookable, so the form is never rendered for one.
  const listing = await getListingBySlug(decodeURIComponent(slug));
  if (!listing) notFound();

  const from = typeof sp.from === "string" ? sp.from : undefined;
  const to = typeof sp.to === "string" ? sp.to : undefined;
  const guestsRaw = Number(typeof sp.guests === "string" ? sp.guests : "");

  /**
   * Is this a day booking (حجز بدون مبيت)?
   *
   * The flag comes from the URL, but it is only *believed* to the extent the
   * listing supports it: a link carrying `dayUse=1` for a rest house whose day
   * rate is 0 falls back to an overnight booking, and the range check below
   * then rejects it as it would any other same-day range. Trusting the query
   * string alone would render a form quoting a day price the owner never set —
   * and the server action refuses such a request anyway, so the guest would
   * fill it in and only then be told no.
   */
  const dayUse = sp.dayUse === "1" && listing.dayUsePrice > 0;

  /**
   * Arriving here without a usable range means the visitor deep-linked or the
   * dates expired. Send them to the calendar rather than rendering a form that
   * can only fail — the calendar is where the decision actually gets made.
   *
   * The two kinds of stay have different shapes: a day booking is one date
   * (`from === to`), a stay is two (`from < to`). Both are checked here, and
   * both again inside `createBookingRequest`.
   */
  const detailPath = `/listings/${encodeURIComponent(listing.slug)}`;
  const rangeOk = dayUse ? from === to : from! < to!;
  if (!isISODate(from) || !isISODate(to) || !rangeOk || from! < todayISO()) {
    // No flag here: a bad or expired range means a stale link or a deep link,
    // and there is nothing to tell the visitor beyond "pick your dates", which
    // is what the calendar they land on already says.
    redirect(`${detailPath}#availability`);
  }

  // Someone else may have taken the dates between the detail page and here.
  const stillFree = await isRangeAvailable(listing.id, from!, to!, dayUse);
  if (!stillFree) {
    // ─── Query BEFORE fragment ────────────────────────────────────────────
    // This used to build `…#availability?unavailable=1`. Everything after the
    // "#" is the fragment, so `?unavailable=1` was part of the fragment string
    // and never reached the server as a search param — the flag could not be
    // read even in principle, and the detail page did not ask for it either.
    // A guest whose dates were taken mid-form was therefore bounced back to the
    // calendar with no explanation at all, which reads as the site losing their
    // booking. The detail page now takes `searchParams` and says so.
    redirect(`${detailPath}?unavailable=1#availability`);
  }

  const settings = await getSettings();
  const guests =
    Number.isFinite(guestsRaw) && guestsRaw > 0
      ? Math.min(guestsRaw, listing.capacity)
      : Math.min(listing.capacity, 20);

  // The listing's own deposit rate, falling back to the platform default only
  // when it has none set. The same resolution runs again inside the server
  // action; this one only drives what the guest is shown.
  const depositPercent = resolveDepositPercent(listing.depositPercent, settings.depositPercent);

  const q = quote({
    checkIn: from!,
    checkOut: to!,
    pricePerNight: listing.pricePerNight,
    weekendPrice: listing.weekendPrice,
    serviceFeePercent: settings.serviceFeePercent,
    depositPercent,
    dayUse,
    dayUsePrice: listing.dayUsePrice,
    dayUseWeekendPrice: listing.dayUseWeekendPrice,
  });

  const l = localizeListing(listing, locale);
  const where = l.area;
  const chevron = locale === "ar" ? "chevron_left" : "chevron_right";

  return (
    <div className="min-h-[70vh] bg-sand-50">
      <div className="mx-auto max-w-[1060px] px-4 pt-6 pb-18 md:px-10">
        <nav
          aria-label={t.nav.home}
          className="mb-4 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted"
        >
          <Link
            href={`/listings/${encodeURIComponent(listing.slug)}`}
            className="text-muted no-underline hover:text-bronze hover:no-underline"
          >
            {l.name}
          </Link>
          <Icon name={chevron} size={15} />
          <span className="font-semibold text-ink">{t.booking.title}</span>
        </nav>

        <h1 className="m-0 mb-2 font-display text-[clamp(22px,2.8vw,32px)] font-extrabold text-ink">
          {t.booking.title}
        </h1>
        <p className="m-0 mb-6.5 max-w-[56ch] text-[15px] text-muted">{t.booking.introBody}</p>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <BookingForm
            listingId={listing.id}
            listingSlug={listing.slug}
            checkIn={from!}
            checkOut={to!}
            dayUse={dayUse}
            dayUseCheckOutTime={l.dayUseCheckOutTime}
            guests={guests}
            capacity={listing.capacity}
            freeCancelHours={settings.freeCancelHours}
            depositPercent={depositPercent}
          />

          {/* ---- summary ---- */}
          <aside className="rounded-[28px] border border-line bg-surface p-5 shadow-e1 lg:sticky lg:top-[150px] lg:border-sand-300 lg:shadow-e2">
            <div className="mb-4 flex gap-3">
              <div className="relative size-17.5 shrink-0 overflow-hidden rounded-[13px] bg-sand-200">
                <Image src={listing.coverUrl} alt="" fill sizes="88px" className="object-cover" />
              </div>
              <div className="min-w-0">
                <h2 className="m-0 mb-1 font-display text-[15px] font-bold leading-snug text-ink">
                  {l.name}
                </h2>
                <div className="flex items-center gap-1 text-[12.5px] text-muted">
                  <Icon name="location_on" size={15} />
                  {where}
                </div>
                {listing.reviewsCount > 0 && (
                  <div className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-bold text-ink">
                    <Icon name="star" size={14} className="text-gold-500" />
                    {arRating(listing.rating, locale)}
                  </div>
                )}
              </div>
            </div>

            <div className="mb-3.5 h-px bg-line" />

            {/* One date for a day booking, two for a stay — and the price line
                names itself rather than rendering "0 nights × the nightly
                rate", which is neither the figure charged nor a sentence that
                makes sense. */}
            <SummaryRow
              label={dayUse ? t.listing.dayUsePickDay : t.listing.dates}
              value={
                dayUse
                  ? arDayMonth(from!, locale)
                  : `${arDayMonth(from!, locale)} – ${arDayMonth(to!, locale)}`
              }
            />
            <SummaryRow
              label={
                dayUse
                  ? t.listing.dayUseLine
                  : t.listing.nightsLine(
                      arNum(listing.pricePerNight, locale),
                      arNum(q.nights, locale),
                      q.nights,
                    )
              }
              value={arNum(q.subtotal, locale)}
            />
            {dayUse && l.dayUseCheckOutTime && (
              <SummaryRow
                label={t.listing.dayUseCheckOut}
                value={l.dayUseCheckOutTime}
                muted
              />
            )}
            {/* Only when a fee actually applies — see the note in
                booking-card.tsx. At the shipped 0% the total is the nights. */}
            {settings.serviceFeePercent > 0 && (
              <SummaryRow
                label={t.listing.serviceFee(arNum(settings.serviceFeePercent, locale))}
                value={arNum(q.serviceFee, locale)}
                muted
              />
            )}
            <SummaryRow label={t.listing.guests} value={arNum(guests, locale)} muted />

            {/* Total AND deposit, both stated before the guest submits. */}
            <div className="mt-3 flex justify-between border-t border-dashed border-line pt-3 font-display text-[17px] font-extrabold text-ink">
              <span>{t.booking.totalAmount}</span>
              <span>
                {arNum(q.total, locale)} {t.common.aed}
              </span>
            </div>

            <div className="mt-2 flex justify-between text-[13.5px] font-bold text-bronze">
              <span>{t.booking.depositAmount}</span>
              <span>
                {depositPercent > 0
                  ? `${arNum(q.depositDue, locale)} ${t.common.aed}`
                  : t.booking.noDepositRequired}
              </span>
            </div>
            {depositPercent > 0 && (
              <p className="m-0 mt-1 text-[11.5px] text-muted">
                {t.booking.depositExplain(arNum(depositPercent, locale))}
              </p>
            )}

            {/* Stated before the guest submits, and kept out of the total —
                it is refundable. The figure written to the request is read
                from the listing again inside the server action. */}
            {listing.securityDeposit > 0 && (
              <div className="mt-2 flex justify-between text-[13px] font-bold text-bronze">
                <span>{t.listing.securityDepositLabel}</span>
                <span>
                  {arNum(listing.securityDeposit, locale)} {t.common.aed}
                </span>
              </div>
            )}

            {/* Payment stub: the flow is shaped for an online deposit, but no
                gateway is wired. See src/lib/payments/index.ts. */}
            <div className="mt-3.5 flex items-center gap-2 rounded-xl bg-ok-bg px-3 py-3 text-[12.5px] font-semibold text-ok">
              <Icon name="lock" size={18} />
              {t.booking.noPaymentOnline}
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
