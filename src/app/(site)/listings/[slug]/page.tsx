import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Gallery } from "@/components/listing/gallery";
import { BookingProvider } from "@/components/listing/booking-context";
import { BookingCard, CalendarSection, MobileBookingBar } from "@/components/listing/booking-card";
import { Icon } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { MapEmbed } from "@/components/listing/map-embed";
import { getListingBySlug, getUnavailableDates } from "@/lib/listings";
import { getSettings, absoluteUrl, localizeSettings } from "@/lib/settings";
import { cityLabel, label as pickLabel } from "@/lib/constants";
import { arNum, arRating, arTimeAgo } from "@/lib/format";
import { resolveDepositPercent } from "@/lib/pricing";
import { resolveListingWhatsapp, whatsappLink } from "@/lib/whatsapp";
import { getI18n } from "@/lib/i18n/server";
import { ogLocale } from "@/lib/i18n/config";

/**
 * ─── Why this page is no longer statically generated ─────────────────────────
 * It used to `generateStaticParams()` every published slug and serve pre-built
 * HTML with hourly revalidation. That is incompatible with reading the locale
 * cookie: a page built once cannot be built in two languages, and a static
 * Arabic document served to an English visitor would arrive with the wrong text
 * *and* the wrong `dir`, then flip after hydration.
 *
 * The trade is deliberate and it is the smaller cost. Correct language and
 * direction on first paint — in the HTML that search engines and screen readers
 * actually read — is worth more than a cached document for a catalogue whose
 * prices and availability were never safe to cache for long anyway. The
 * expensive parts (images, fonts, the optimiser's derived sizes) are cached
 * exactly as before; what is recomputed is two indexed queries.
 *
 * If per-language static generation is wanted later, the fix is a `[locale]`
 * route segment — see the note at the top of src/lib/i18n/config.ts for what
 * that would cost elsewhere.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [{ t, locale }, listing] = await Promise.all([
    getI18n(),
    getListingBySlug(decodeURIComponent(slug)),
  ]);
  if (!listing) return { title: t.listing.notFound };

  const settings = await getSettings();
  const s = localizeSettings(settings, locale);
  const where = listing.area || cityLabel(listing.city, locale);

  const description = (
    locale === "en"
      ? `${listing.name} in ${where} — sleeps up to ${listing.capacity} guests, from ${listing.pricePerNight} AED per night. ${listing.description}`
      : `${listing.name} في ${where} — تتسع حتى ${listing.capacity} ضيف، السعر من ${listing.pricePerNight} د.إ لليلة. ${listing.description}`
  ).slice(0, 300);

  const path = `/listings/${encodeURIComponent(listing.slug)}`;

  return {
    title: `${listing.name} — ${where}`,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      title: `${listing.name} — ${where}`,
      description,
      url: absoluteUrl(path),
      siteName: s.siteName,
      locale: ogLocale(locale),
      // Dynamic OG card, generated per listing — see src/app/api/og/route.tsx
      images: [
        {
          url: `/api/og?title=${encodeURIComponent(listing.name)}&area=${encodeURIComponent(where)}&price=${listing.pricePerNight}&capacity=${listing.capacity}`,
          width: 1200,
          height: 630,
          alt: listing.name,
        },
      ],
    },
  };
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // `getListingBySlug` applies the shared public predicate, so a listing whose
  // owner is suspended, rejected or out of membership 404s by direct URL just as
  // it disappears from the grid. Hiding it from the grid while leaving the slug
  // reachable would not be hiding it at all.
  const listing = await getListingBySlug(decodeURIComponent(slug));
  if (!listing) notFound();

  const [settings, unavailable, { t, locale }] = await Promise.all([
    getSettings(),
    getUnavailableDates(listing.id),
    getI18n(),
  ]);

  const s = localizeSettings(settings, locale);
  const where = listing.area || cityLabel(listing.city, locale);

  // The deposit shown here is the same value the server will charge: resolved
  // from the listing's own rate, falling back to the platform default only when
  // the listing has none set. null and 0 mean different things — see
  // `resolveDepositPercent`.
  const depositPercent = resolveDepositPercent(
    listing.depositPercent,
    settings.depositPercent,
  );

  // Contact resolves through the owner relation for an owned listing, so this
  // button opens *that owner's* WhatsApp — never the platform's.
  const contact = resolveListingWhatsapp(listing, settings.whatsappNumber, t.common.owner);
  const contactHref = whatsappLink(contact.digits);

  /**
   * `LodgingBusiness` + aggregate rating. This is what makes a listing eligible
   * for the star-rating rich result, which is a real click-through advantage
   * over a plain blue link.
   */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LodgingBusiness",
    name: listing.name,
    description: listing.description,
    url: absoluteUrl(`/listings/${encodeURIComponent(listing.slug)}`),
    image: listing.images.map((i) => i.url),
    // The owner's number, not the site's — the same resolution the contact
    // button uses, so structured data and the visible page agree.
    telephone: contact.display || settings.whatsappNumber,
    priceRange: `${listing.pricePerNight}–${listing.weekendPrice || listing.pricePerNight} AED`,
    maximumAttendeeCapacity: listing.capacity,
    address: {
      "@type": "PostalAddress",
      addressLocality: cityLabel(listing.city, locale),
      addressRegion: listing.area,
      addressCountry: "AE",
    },
    geo: { "@type": "GeoCoordinates", latitude: listing.lat, longitude: listing.lng },
    amenityFeature: listing.amenityList.map((a) => ({
      "@type": "LocationFeatureSpecification",
      name: pickLabel(a, locale),
      value: true,
    })),
    ...(listing.reviewsCount > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: listing.rating,
            reviewCount: listing.reviewsCount,
            bestRating: 5,
            worstRating: 1,
          },
          review: listing.reviews.slice(0, 5).map((r) => ({
            "@type": "Review",
            author: { "@type": "Person", name: r.authorName },
            reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5 },
            reviewBody: r.body,
            datePublished: r.createdAt.toISOString().slice(0, 10),
          })),
        }
      : {}),
  };

  const chevron = locale === "ar" ? "chevron_left" : "chevron_right";

  return (
    <BookingProvider
      unavailableDates={[...unavailable]}
      pricePerNight={listing.pricePerNight}
      weekendPrice={listing.weekendPrice}
      serviceFeePercent={settings.serviceFeePercent}
      depositPercent={depositPercent}
      capacity={listing.capacity}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="bg-sand-50">
        {/* ---- breadcrumb + gallery ---- */}
        <div className="mx-auto max-w-[1280px] px-4 pt-4 md:px-10">
          <nav
            aria-label={t.nav.home}
            className="mb-3.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted"
          >
            <Link href="/" className="text-muted no-underline hover:text-bronze hover:no-underline">
              {t.nav.home}
            </Link>
            <Icon name={chevron} size={15} />
            <Link
              href="/listings"
              className="text-muted no-underline hover:text-bronze hover:no-underline"
            >
              {t.listings.title}
            </Link>
            <Icon name={chevron} size={15} />
            <span className="font-semibold text-ink">{listing.name}</span>
          </nav>

          <Gallery
            listingId={listing.id}
            name={listing.name}
            images={listing.images}
            verified={listing.verified}
          />
        </div>

        {/* ---- body ---- */}
        <div className="mx-auto grid max-w-[1280px] items-start gap-7 px-4 pt-2 md:px-10 lg:grid-cols-[minmax(0,1fr)_356px]">
          <div className="min-w-0">
            {/* title block */}
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
              <div className="min-w-0">
                <h1 className="m-0 mb-2 font-display text-[clamp(22px,2.8vw,34px)] font-extrabold leading-tight text-ink">
                  {listing.name}
                </h1>
                <div className="flex flex-wrap items-center gap-3.5 text-[14px] text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="location_on" size={18} className="text-gold-600" />
                    {where}
                  </span>

                  {listing.reviewsCount > 0 ? (
                    <span className="inline-flex items-center gap-1.5 font-bold text-ink">
                      <Icon name="star" size={17} className="text-gold-500" />
                      {arRating(listing.rating, locale)}
                      <span className="font-medium text-muted">
                        ({t.listing.reviewCount(arNum(listing.reviewsCount, locale), listing.reviewsCount)})
                      </span>
                    </span>
                  ) : (
                    <Badge tone="gold">{t.listing.noReviews}</Badge>
                  )}

                  {listing.bookingsCount > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="history" size={17} />
                      {t.listing.pastBookings(arNum(listing.bookingsCount, locale))}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* about + key facts */}
            <section className="border-b border-line py-6">
              <h2 className="m-0 mb-2.5 font-display text-[19px] font-extrabold text-ink">
                {t.listing.descriptionTitle}
              </h2>
              <p className="m-0 mb-4 text-[15.5px] leading-[2] text-ink/86">
                {listing.description}
              </p>

              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                <Fact
                  icon="group"
                  label={t.listing.maxCapacity}
                  value={t.common.upToGuests(arNum(listing.capacity, locale), listing.capacity)}
                />
                <Fact
                  icon="schedule"
                  label={t.listing.checkInOutLabel}
                  value={`${s.checkInTime} / ${s.checkOutTime}`}
                />
                {/* The deposit is stated on the page *before* a guest sends a
                    request, which is the promise the trust section makes. A 0%
                    deposit says so explicitly rather than showing "0%". */}
                <Fact
                  icon="savings"
                  label={t.listing.depositLabel}
                  value={
                    depositPercent > 0
                      ? t.listing.depositOnConfirm(arNum(depositPercent, locale))
                      : t.booking.noDepositRequired
                  }
                />
                <Fact
                  icon="event_repeat"
                  label={t.listing.freeCancelLabel}
                  value={t.listing.upToHours(arNum(settings.freeCancelHours, locale))}
                />
              </div>
            </section>

            {/* amenities */}
            {listing.amenityList.length > 0 && (
              <section className="border-b border-line py-6">
                <h2 className="m-0 mb-4 font-display text-[19px] font-extrabold text-ink">
                  {t.listing.amenitiesTitle}
                </h2>
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {listing.amenityList.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-3 rounded-[13px] border border-line bg-surface px-3.5 py-3"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-gold-100">
                        <Icon name={a.icon as never} size={20} className="text-bronze" />
                      </span>
                      <span className="text-[14px] font-semibold text-ink">
                        {pickLabel(a, locale)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* availability calendar (shares state with the sidebar card) */}
            <CalendarSection checkIn={s.checkInTime} checkOut={s.checkOutTime} />

            {/* location — the per-listing Leaflet map, which is a different
                component from the removed footer embed and stays. */}
            <section className="border-b border-line py-6">
              <h2 className="m-0 mb-1.5 font-display text-[19px] font-extrabold text-ink">
                {t.listing.locationTitle}
              </h2>
              <p className="m-0 mb-3.5 text-[13.5px] text-muted">
                {t.listing.locationNote(where)}
              </p>
              <div className="h-80 overflow-hidden rounded-[20px] border border-line bg-sand-200 shadow-e1">
                <MapEmbed
                  points={[
                    {
                      id: listing.id,
                      lat: listing.lat,
                      lng: listing.lng,
                      name: listing.name,
                      area: where,
                      capacity: listing.capacity,
                    },
                  ]}
                  zoom={12}
                />
              </div>
            </section>

            {/* reviews */}
            <section className="py-6 pb-8">
              <div className="mb-4.5 flex flex-wrap items-center gap-3">
                <h2 className="m-0 font-display text-[19px] font-extrabold text-ink">
                  {t.listing.reviewsTitle}
                </h2>
                {listing.reviewsCount > 0 && (
                  <Badge tone="gold" icon="star">
                    {t.listing.ratingOutOf(
                      arRating(listing.rating, locale),
                      arNum(listing.reviewsCount, locale),
                    )}
                  </Badge>
                )}
              </div>

              {listing.reviews.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-sand-300 bg-surface px-6 py-9 text-center">
                  <Icon name="rate_review" size={40} className="mx-auto text-sand-400" />
                  <h3 className="mt-3 mb-1.5 font-display text-[17px] font-bold text-ink">
                    {t.listing.beFirstToReview}
                  </h3>
                  <p className="mx-auto m-0 max-w-[40ch] text-[14px] leading-[1.85] text-muted">
                    {t.listing.beFirstToReviewBody}
                  </p>
                </div>
              ) : (
                <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
                  {listing.reviews.map((r) => (
                    <article key={r.id} className="rounded-[20px] border border-line bg-surface p-5">
                      <div className="mb-3 flex items-center gap-3">
                        <span className="grid size-9.5 place-items-center rounded-full bg-sand-200 text-bronze">
                          <Icon name="person" size={21} />
                        </span>
                        <span className="flex-1">
                          <span className="block text-[14px] font-bold text-ink">
                            {r.authorName}
                          </span>
                          <span className="block text-[12px] text-muted">
                            {arTimeAgo(r.createdAt, new Date(), locale)}
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1 text-[13px] font-bold text-ink">
                          <Icon name="star" size={15} className="text-gold-500" />
                          {arRating(r.rating, locale)}
                        </span>
                      </div>
                      <p className="m-0 text-[14px] leading-[1.9] text-ink/84">{r.body}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>

          <BookingCard
            slug={listing.slug}
            pricePerNight={listing.pricePerNight}
            weekendPrice={listing.weekendPrice}
            capacity={listing.capacity}
            ownerName={contact.name}
            serviceFeePercent={settings.serviceFeePercent}
            depositPercent={depositPercent}
            freeCancelHours={settings.freeCancelHours}
            // "" when the listing has no usable number, which hides the button
            // rather than pointing it at a bare wa.me/.
            ownerWhatsappHref={contactHref}
          />
        </div>

        <MobileBookingBar slug={listing.slug} pricePerNight={listing.pricePerNight} />
      </div>
    </BookingProvider>
  );
}

function Fact({
  icon,
  label,
  value,
}: {
  icon: "group" | "schedule" | "savings" | "event_repeat";
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 py-3">
      <Icon name={icon} size={22} className="text-bronze" />
      <span>
        <span className="block text-[11.5px] text-muted">{label}</span>
        <span className="block text-[14px] font-bold text-ink">{value}</span>
      </span>
    </div>
  );
}
