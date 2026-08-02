import Link from "next/link";
import type { Metadata } from "next";
import { ListingCard } from "@/components/listing/listing-card";
import { toCardData } from "@/components/listing/card-data";
import { FiltersAside, FiltersTrigger } from "@/components/listing/filters-panel";
import { ResultsToolbar } from "@/components/listing/results-toolbar";
import { Icon } from "@/components/ui/icon";
import { ButtonLink } from "@/components/ui/button";
import { findListings, localizeListing, type ListingFilters } from "@/lib/listings";
import { getSettings } from "@/lib/settings";
import { localizeSettings } from "@/lib/settings";
import { getI18n } from "@/lib/i18n/server";
import { cityLabel, isSortId, normalizeCityId } from "@/lib/constants";
import { arNum } from "@/lib/format";
import { arDayMonth, isISODate } from "@/lib/dates";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const [settings, { t, locale }] = await Promise.all([getSettings(), getI18n()]);
  const s = localizeSettings(settings, locale);
  const city = normalizeCityId(typeof sp.city === "string" ? sp.city : undefined);

  // A city-filtered view gets its own title/description so each is a distinct,
  // indexable landing page rather than duplicate content.
  const title =
    city && city !== "all"
      ? t.listings.metaTitleCity(cityLabel(city, locale))
      : t.listings.metaTitleAll;

  return {
    title,
    description:
      city && city !== "all"
        ? t.listings.metaDescCity(cityLabel(city, locale), s.siteName)
        : s.seoDescription || undefined,
    alternates: { canonical: city && city !== "all" ? `/listings?city=${city}` : "/listings" },
  };
}

/** Read the query string into typed filters, ignoring anything malformed. */
function parseFilters(sp: Record<string, string | string[] | undefined>): ListingFilters {
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const num = (k: string) => {
    const v = Number(str(k));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };

  const from = str("from");
  const to = str("to");

  return {
    // A bookmarked ?city=alain link still resolves — see normalizeCityId.
    city: normalizeCityId(str("city")),
    category: str("category"),
    maxPrice: num("maxPrice"),
    minCapacity: num("capacity"),
    amenities: (str("amenities") ?? "").split(",").filter(Boolean),
    sort: isSortId(str("sort")) ? str("sort")! : "reco",
    q: str("q"),
    // Only honour a date range if BOTH ends are valid dates in order.
    availableFrom: isISODate(from) && isISODate(to) && from! < to! ? from : undefined,
    availableTo: isISODate(from) && isISODate(to) && from! < to! ? to : undefined,
  } as ListingFilters;
}

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sp, { t, locale }] = await Promise.all([searchParams, getI18n()]);
  const filters = parseFilters(sp);
  const listings = await findListings(filters);

  // The marker popups are prose too — an English visitor panning the map should
  // not meet Arabic names there alone.
  const mapPoints = listings.map((listing) => {
    const l = localizeListing(listing, locale);
    return {
      id: listing.id,
      lat: listing.lat,
      lng: listing.lng,
      name: l.name,
      area: l.area,
      price: listing.pricePerNight,
      capacity: listing.capacity,
      href: `/listings/${encodeURIComponent(listing.slug)}`,
    };
  });

  const heading =
    filters.city && filters.city !== "all"
      ? t.listings.headingCity(cityLabel(filters.city, locale))
      : t.listings.headingAll;

  const dateLine =
    filters.availableFrom && filters.availableTo
      ? `${arDayMonth(filters.availableFrom, locale)} – ${arDayMonth(filters.availableTo, locale)}`
      : null;

  return (
    <div className="min-h-[70vh] bg-sand-50">
      {/* ---- results header ---- */}
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[1280px] px-4 pt-4.5 md:px-10">
          <nav
            aria-label={t.listings.breadcrumb}
            className="mb-2.5 flex items-center gap-1.5 text-[12.5px] text-muted"
          >
            <Link href="/" className="text-muted no-underline hover:text-bronze hover:no-underline">
              {t.nav.home}
            </Link>
            <Icon name={locale === "ar" ? "chevron_left" : "chevron_right"} size={15} />
            <span className="font-semibold text-ink">{t.listings.breadcrumb}</span>
          </nav>

          <h1 className="m-0 mb-1 font-display text-[clamp(20px,2.4vw,28px)] font-extrabold text-ink">
            {heading}
          </h1>
          <p className="m-0 mb-4 text-[14px] text-muted">
            <span className="font-bold text-bronze">
              {t.common.results(arNum(listings.length, locale), listings.length)}
            </span>
            {dateLine && <> · {dateLine}</>}
            {filters.q && <> · «{filters.q}»</>}
          </p>

          <div className="flex flex-wrap items-center gap-2.5 pb-3.5">
            <FiltersTrigger resultCount={listings.length} />
            <ResultsToolbar points={mapPoints} />
          </div>
        </div>
      </div>

      {/* ---- sidebar + grid ---- */}
      <div className="mx-auto grid max-w-[1280px] gap-6 px-4 pt-5.5 pb-16 md:px-10 lg:grid-cols-[288px_minmax(0,1fr)]">
        <FiltersAside resultCount={listings.length} />

        <div className="min-w-0">
          {listings.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-sand-300 bg-surface px-6 py-14 text-center">
              <Icon name="travel_explore" size={46} className="mx-auto text-sand-400" />
              <h2 className="mt-3.5 mb-2 font-display text-[18px] font-bold text-ink">
                {t.listings.emptyTitle}
              </h2>
              <p className="m-0 mb-4.5 text-[14px] text-muted">
                {t.listings.emptyBodyLong}
              </p>
              <ButtonLink href="/listings">{t.listings.resetFilters}</ButtonLink>
            </div>
          ) : (
            <div className="grid gap-4.5 sm:grid-cols-2 xl:grid-cols-3">
              {listings.map((listing, i) => (
                <ListingCard
                  key={listing.id}
                  listing={toCardData(listing)}
                  showCityBadge
                  priority={i < 3}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
