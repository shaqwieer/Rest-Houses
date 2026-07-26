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
import { getSettings, absoluteUrl } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { cityLabel } from "@/lib/constants";
import { arNum, arRating, arTimeAgo } from "@/lib/format";

/**
 * Pre-render every published listing at build time, then keep them fresh with
 * on-demand revalidation. Detail pages are the most-shared URLs on the site, so
 * serving them as static HTML is the single biggest perceived-speed win.
 * Listings created later still work — Next renders them on first request and
 * caches the result (the default `dynamicParams: true`).
 *
 * The database is OPTIONAL here. A container image is built without one — there
 * is no Postgres during `docker build`, and coupling an image build to a running
 * database would be wrong anyway. When the query fails we return no params: the
 * build succeeds, and every listing page is then rendered on first request and
 * cached from there. Same output, just built lazily.
 */
export async function generateStaticParams() {
  try {
    const rows = await prisma.listing.findMany({
      where: { published: true },
      select: { slug: true },
    });
    return rows.map((r) => ({ slug: r.slug }));
  } catch {
    return [];
  }
}

/** Rebuild at most once an hour even without an explicit revalidate call, so an
 *  edit made directly in the database still surfaces. */
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const listing = await getListingBySlug(decodeURIComponent(slug));
  if (!listing) return { title: "الاستراحة غير موجودة" };

  const settings = await getSettings();
  const where = listing.area || cityLabel(listing.city);
  const description = `${listing.name} في ${where} — تتسع حتى ${listing.capacity} ضيف، السعر من ${listing.pricePerNight} د.إ لليلة. ${listing.description}`.slice(
    0,
    300,
  );
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
      siteName: settings.siteName,
      locale: "ar_AE",
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
  const listing = await getListingBySlug(decodeURIComponent(slug));
  if (!listing) notFound();

  const [settings, unavailable] = await Promise.all([
    getSettings(),
    getUnavailableDates(listing.id),
  ]);

  const where = listing.area || cityLabel(listing.city);
  const ownerName = listing.ownerName || "المالك";

  /**
   * `LodgingBusiness` + aggregate rating. This is what makes a listing eligible
   * for the star-rating rich result in Arabic search, which is a real
   * click-through advantage over a plain blue link.
   */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LodgingBusiness",
    name: listing.name,
    description: listing.description,
    url: absoluteUrl(`/listings/${encodeURIComponent(listing.slug)}`),
    image: listing.images.map((i) => i.url),
    telephone: listing.ownerWhatsapp || settings.whatsappNumber,
    priceRange: `${listing.pricePerNight}–${listing.weekendPrice || listing.pricePerNight} AED`,
    maximumAttendeeCapacity: listing.capacity,
    address: {
      "@type": "PostalAddress",
      addressLocality: cityLabel(listing.city),
      addressRegion: listing.area,
      addressCountry: "AE",
    },
    geo: { "@type": "GeoCoordinates", latitude: listing.lat, longitude: listing.lng },
    amenityFeature: listing.amenityList.map((a) => ({
      "@type": "LocationFeatureSpecification",
      name: a.ar,
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

  return (
    <BookingProvider
      unavailableDates={[...unavailable]}
      pricePerNight={listing.pricePerNight}
      weekendPrice={listing.weekendPrice}
      serviceFeePercent={settings.serviceFeePercent}
      depositPercent={settings.depositPercent}
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
            aria-label="مسار التنقل"
            className="mb-3.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted"
          >
            <Link href="/" className="text-muted no-underline hover:text-bronze hover:no-underline">
              الرئيسية
            </Link>
            <Icon name="chevron_left" size={15} />
            <Link
              href="/listings"
              className="text-muted no-underline hover:text-bronze hover:no-underline"
            >
              النتائج
            </Link>
            <Icon name="chevron_left" size={15} />
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
                      {arRating(listing.rating)}
                      <span className="font-medium text-muted">
                        ({arNum(listing.reviewsCount)} تقييم)
                      </span>
                    </span>
                  ) : (
                    <Badge tone="gold">استراحة جديدة — لا تقييمات بعد</Badge>
                  )}

                  {listing.bookingsCount > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="history" size={17} />
                      {arNum(listing.bookingsCount)} حجز سابق
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* about + key facts */}
            <section className="border-b border-line py-6">
              <h2 className="m-0 mb-2.5 font-display text-[19px] font-extrabold text-ink">
                عن الاستراحة
              </h2>
              <p className="m-0 mb-4 text-[15.5px] leading-[2] text-ink/86">{listing.description}</p>

              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                <Fact icon="group" label="السعة القصوى" value={`${arNum(listing.capacity)} ضيف`} />
                <Fact
                  icon="schedule"
                  label="الدخول / الخروج"
                  value={`${settings.checkInTime} / ${settings.checkOutTime}`}
                />
                <Fact
                  icon="savings"
                  label="العربون"
                  value={`${arNum(settings.depositPercent)}٪ عند التأكيد`}
                />
                <Fact
                  icon="event_repeat"
                  label="الإلغاء المجاني"
                  value={`حتى ${arNum(settings.freeCancelHours)} ساعة`}
                />
              </div>
            </section>

            {/* amenities */}
            {listing.amenityList.length > 0 && (
              <section className="border-b border-line py-6">
                <h2 className="m-0 mb-4 font-display text-[19px] font-extrabold text-ink">
                  المرافق والخدمات
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
                      <span className="text-[14px] font-semibold text-ink">{a.ar}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* availability calendar (shares state with the sidebar card) */}
            <CalendarSection
              checkIn={settings.checkInTime}
              checkOut={settings.checkOutTime}
            />

            {/* location */}
            <section className="border-b border-line py-6">
              <h2 className="m-0 mb-1.5 font-display text-[19px] font-extrabold text-ink">الموقع</h2>
              <p className="m-0 mb-3.5 text-[13.5px] text-muted">
                {where} — يُرسل الموقع الدقيق على الخريطة بعد تأكيد الحجز.
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
                <h2 className="m-0 font-display text-[19px] font-extrabold text-ink">التقييمات</h2>
                {listing.reviewsCount > 0 && (
                  <Badge tone="gold" icon="star">
                    {arRating(listing.rating)} من {arNum(listing.reviewsCount)} تقييم
                  </Badge>
                )}
              </div>

              {listing.reviews.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-sand-300 bg-surface px-6 py-9 text-center">
                  <Icon name="rate_review" size={40} className="mx-auto text-sand-400" />
                  <h3 className="mt-3 mb-1.5 font-display text-[17px] font-bold text-ink">
                    كن أول من يقيّم هذه الاستراحة
                  </h3>
                  <p className="mx-auto m-0 max-w-[40ch] text-[14px] leading-[1.85] text-muted">
                    أُضيفت حديثًا إلى المنصة ولم تستقبل تقييمات بعد. شاركنا تجربتك بعد إقامتك.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
                  {listing.reviews.map((r) => (
                    <article
                      key={r.id}
                      className="rounded-[20px] border border-line bg-surface p-5"
                    >
                      <div className="mb-3 flex items-center gap-3">
                        <span className="grid size-9.5 place-items-center rounded-full bg-sand-200 text-bronze">
                          <Icon name="person" size={21} />
                        </span>
                        <span className="flex-1">
                          <span className="block text-[14px] font-bold text-ink">
                            {r.authorName}
                          </span>
                          <span className="block text-[12px] text-muted">
                            {arTimeAgo(r.createdAt)}
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1 text-[13px] font-bold text-ink">
                          <Icon name="star" size={15} className="text-gold-500" />
                          {arRating(r.rating)}
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
            ownerName={ownerName}
            serviceFeePercent={settings.serviceFeePercent}
            depositPercent={settings.depositPercent}
            freeCancelHours={settings.freeCancelHours}
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
