import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { ButtonLink } from "@/components/ui/button";
import { WhatsappAutoSend } from "@/components/booking/whatsapp-auto-send";
import { prisma } from "@/lib/prisma";
import { getSettings, absoluteUrl, localizeSettings } from "@/lib/settings";
import { bookingRequestMessage, resolveListingWhatsapp, whatsappLink } from "@/lib/whatsapp";
import { localizeListing } from "@/lib/listings";
import { publicOwnerFields } from "@/lib/owners";
import { isDepositPaymentEnabled } from "@/lib/payments";
import { arDayMonth } from "@/lib/dates";
import { arNum, formatReference } from "@/lib/format";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t.booking.confirmTitle,
    robots: { index: false, follow: false },
  };
}

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
 *
 * ─── Whose number this opens ─────────────────────────────────────────────────
 * It used to be `listing.ownerWhatsapp || settings.whatsappNumber` — a
 * per-listing copy with the *platform's* number as the fallback, so any listing
 * without its own copy sent the guest to the operator. It now resolves through
 * the owner relation, so an owned listing always reaches its own owner and never
 * falls back to the site-wide number. See `resolveListingWhatsapp`.
 */
export default async function BookingConfirmationPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const { t, locale } = await getI18n();

  const booking = await prisma.bookingRequest.findUnique({
    where: { reference: decodeURIComponent(reference) },
    include: {
      listing: {
        select: {
          name: true,
          nameEn: true,
          slug: true,
          area: true,
          areaEn: true,
          city: true,
          description: true,
          descriptionEn: true,
          // Selected because a day booking's WhatsApp message quotes the
          // leave-by hour. `localizeListing` returns "" for columns a caller
          // did not ask for, so omitting these would drop the line silently —
          // no error, just an owner who never learns when the guest leaves.
          dayUseCheckOutTime: true,
          dayUseCheckOutTimeEn: true,
          ownerName: true,
          ownerWhatsapp: true,
          owner: { select: publicOwnerFields() },
        },
      },
    },
  });

  if (!booking) notFound();

  const settings = await getSettings();
  const s = localizeSettings(settings, locale);
  // The whole confirmation, including the WhatsApp text the guest is about to
  // send, is written in the language they booked in.
  const l = localizeListing(booking.listing, locale);

  const contact = resolveListingWhatsapp(
    booking.listing,
    settings.whatsappNumber,
    t.common.owner,
  );

  const message = bookingRequestMessage({
    siteName: s.siteName,
    reference: booking.reference,
    listingName: l.name,
    listingArea: l.area,
    listingUrl: absoluteUrl(`/listings/${encodeURIComponent(booking.listing.slug)}`),
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    nights: booking.nights,
    // So the owner reads "day booking, leave by 10pm" rather than a check-out
    // date identical to the check-in and a night count of zero.
    dayUse: booking.dayUse,
    dayUseCheckOutTime: l.dayUseCheckOutTime,
    guests: booking.guests,
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    total: booking.total,
    // The snapshot stored with the booking, never the listing's current rate —
    // the message a guest sends must match what they were quoted.
    depositDue: booking.depositDue,
    depositPercent: booking.depositPercent,
    // The booking's own snapshot, not the listing's current figure — see the
    // note on the column in prisma/schema.prisma.
    securityDeposit: booking.securityDeposit,
    notes: booking.notes,
    locale,
  });

  const waHref = whatsappLink(contact.digits, message);
  const depositEnabled = isDepositPaymentEnabled(settings);
  const ref = formatReference(booking.reference, locale);

  return (
    <div className="min-h-[70vh] bg-sand-50">
      <div className="animate-pop-in mx-auto max-w-[620px] px-4 py-10 text-center md:py-15">
        <div className="mx-auto mb-6 grid size-24 place-items-center rounded-full border-2 border-ok/25 bg-ok-bg">
          <Icon name="check_circle" size={52} className="text-ok" />
        </div>

        <h1 className="m-0 mb-3 font-display text-[clamp(23px,3vw,32px)] font-extrabold text-ink">
          {t.booking.confirmTitle}
        </h1>
        <p className="m-0 mb-2 text-[15.5px] leading-[1.9] text-muted">{t.booking.confirmBody}</p>

        <div className="my-4 inline-flex flex-col items-center gap-1.5 rounded-[22px] bg-gold-100 px-5 py-2.5 text-[14px] font-bold text-bronze">
          <Icon name="confirmation_number" size={19} />
          <div>
            {t.booking.reference}: <span dir="ltr">{ref}</span>
          </div>
        </div>

        {/* ---- the WhatsApp hand-off ----
            Above the summary, not below it, and the reason is the countdown.

            This block sends the guest to WhatsApp on its own after five
            seconds. Below a summary card it was off-screen on a phone: the
            page navigated away while the guest was still reading the totals,
            with the "stop" button they never saw scrolled out of view. An
            automatic action has to be visible for as long as it is counting, or
            it is not really cancellable.

            Reading order works out too — the summary is a receipt to check
            afterwards, while sending the request is the one thing still to do.

            See the component for why it navigates this tab rather than opening
            a new one, and how a back-button return is stopped from re-firing.
            `waHref` is "" when the listing has no usable number, and the
            component renders nothing in that case. */}
        <div className="mb-6 flex flex-col items-center gap-3">
          <WhatsappAutoSend href={waHref} reference={booking.reference} />
        </div>

        {/* ---- summary ---- */}
        <div className="mb-5.5 rounded-[28px] border border-line bg-surface p-5.5 text-start shadow-e1">
          <h2 className="m-0 mb-4 font-display text-[16px] font-extrabold text-ink">
            {t.booking.summaryTitle}
          </h2>
          <Row label={t.admin.listings} value={l.name} />
          {/* A day booking is one date and no nights. Rendering "28 July –
              28 July" and then "Nights: 0" on a confirmation screen would read
              as a broken booking at the exact moment the guest is checking
              their booking is right. */}
          <Row
            label={booking.dayUse ? t.listing.dayUsePickDay : t.listing.dates}
            value={
              booking.dayUse
                ? arDayMonth(booking.checkIn, locale)
                : `${arDayMonth(booking.checkIn, locale)} – ${arDayMonth(booking.checkOut, locale)}`
            }
          />
          {booking.dayUse ? (
            <Row label={t.listing.stayType} value={t.listing.stayDayUse} />
          ) : (
            <Row label={t.common.night} value={arNum(booking.nights, locale)} />
          )}
          <Row label={t.listing.guests} value={arNum(booking.guests, locale)} />
          <Row label={t.booking.fullName} value={booking.customerName} />
          <Row
            label={t.booking.totalAmount}
            value={`${arNum(booking.total, locale)} ${t.common.aed}`}
            emphasis
          />
          {/* Both figures appear on the receipt, using the snapshotted rate. */}
          <Row
            label={t.booking.depositAmount}
            value={
              booking.depositDue > 0
                ? `${arNum(booking.depositDue, locale)} ${t.common.aed} (${arNum(
                    booking.depositPercent,
                    locale,
                  )}${locale === "ar" ? "٪" : "%"})`
                : t.booking.noDepositRequired
            }
            emphasis
            last={booking.securityDeposit === 0}
          />
          {/* Listed after the total rather than inside it — refundable money is
              not part of what the stay costs. */}
          {booking.securityDeposit > 0 && (
            <Row
              label={t.listing.securityDepositLabel}
              value={`${arNum(booking.securityDeposit, locale)} ${t.common.aed}`}
              emphasis
              last
            />
          )}
        </div>

        {/* ---- deposit: disabled stub ----
            When an online-deposit gateway is enabled from /admin/settings this
            block becomes the "pay now" step. Until then it states plainly how
            the deposit is collected. */}
        <div className="mb-5.5 flex items-start gap-3 rounded-2xl border border-line bg-sand-100 p-4 text-start">
          <Icon name="savings" size={20} className="shrink-0 text-bronze" />
          <p className="m-0 text-[12.5px] leading-[1.8] text-muted">
            {booking.depositDue === 0
              ? t.booking.noDepositRequired
              : depositEnabled
                ? t.booking.depositPayOnline(arNum(booking.depositDue, locale))
                : t.booking.depositCollectedByOwner(arNum(booking.depositDue, locale))}
          </p>
        </div>

        {booking.securityDeposit > 0 && (
          <div className="mb-5.5 flex items-start gap-3 rounded-2xl border border-line bg-sand-100 p-4 text-start">
            <Icon name="shield" size={20} className="shrink-0 text-bronze" />
            <p className="m-0 text-[12.5px] leading-[1.8] text-muted">
              {t.booking.securityDepositNote(arNum(booking.securityDeposit, locale))}
            </p>
          </div>
        )}

        {/* "Browse rest houses" stays at the bottom. It is where the guest goes
            *after* they are done here, so it belongs below the receipt — and it
            must not sit next to the WhatsApp button, where a guest reaching for
            the one that matters could tap it by mistake and leave the page mid
            countdown. */}
        <div className="flex flex-col items-center gap-3">
          <ButtonLink href="/listings" variant="secondary" size="lg">
            {t.common.browse}
          </ButtonLink>
        </div>

        <p className="m-0 mt-5 text-[12px] text-muted">
          {t.booking.keepReference} <span dir="ltr">{ref}</span>
          {settings.email && (
            <>
              {" · "}
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
          emphasis ? "font-display text-[16px] font-extrabold text-ink" : "font-bold text-ink"
        }
      >
        {value}
      </span>
    </div>
  );
}
