import Link from "next/link";
import type { Metadata } from "next";
import { ListingCard } from "@/components/listing/listing-card";
import { toCardData } from "@/components/listing/card-data";
import { FiltersAside, FiltersTrigger } from "@/components/listing/filters-panel";
import { ResultsToolbar } from "@/components/listing/results-toolbar";
import { TrackEvent } from "@/components/site/track-event";
import { Icon } from "@/components/ui/icon";
import { ButtonLink } from "@/components/ui/button";
import { findListings, localizeListing } from "@/lib/listings";
import { getSettings } from "@/lib/settings";
import { localizeSettings } from "@/lib/settings";
import { getI18n } from "@/lib/i18n/server";
import { cityLabel, getListingType, label } from "@/lib/constants";
import { arNum } from "@/lib/format";
import { arDayMonth } from "@/lib/dates";
import { parseListingFilters, stayQuery, type ListingFilters } from "@/lib/search";
import type { Dictionary } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/config";

/**
 * What this results page is, in words — the heading and the page title.
 *
 * Named after the search rather than always "rest houses in the UAE", because
 * every popular-search link on the home page, and every Google Ads ad group
 * pointed at one, lands here: «مزارع للإيجار» should open on a page that says
 * "farms for rent". Only a pool is called out of the amenities — it is the one
 * people search for by name.
 */
function resultsHeading(filters: ListingFilters, t: Dictionary, locale: Locale): string {
  const place = filters.city && filters.city !== "all" ? cityLabel(filters.city, locale) : null;
  return t.listings.resultsHeading(
    filters.type === "farm",
    (filters.amenities ?? []).includes("pool"),
    place,
    filters.q?.trim() || null,
  );
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const [settings, { t, locale }] = await Promise.all([getSettings(), getI18n()]);
  const s = localizeSettings(settings, locale);
  const filters = parseListingFilters(sp);
  const city = filters.city && filters.city !== "all" ? filters.city : undefined;

  // Each landing view — an emirate, farms, farms in an emirate — gets its own
  // title and canonical, so each is a distinct page rather than duplicate
  // content. Dates, guests and sort stay out of the canonical: they narrow the
  // same page, they do not make a new one.
  const canonical = new URLSearchParams();
  if (city) canonical.set("city", city);
  if (filters.type) canonical.set("type", filters.type);
  const canonicalQuery = canonical.toString();

  return {
    title: resultsHeading(filters, t, locale),
    description: city
      ? t.listings.metaDescCity(cityLabel(city, locale), s.siteName)
      : s.seoDescription || undefined,
    alternates: { canonical: canonicalQuery ? `/listings?${canonicalQuery}` : "/listings" },
  };
}

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sp, { t, locale }] = await Promise.all([searchParams, getI18n()]);
  const filters = parseListingFilters(sp);
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

  const heading = resultsHeading(filters, t, locale);
  const listingType = getListingType(filters.type);

  const dateLine =
    filters.availableFrom && filters.availableTo
      ? `${arDayMonth(filters.availableFrom, locale)} – ${arDayMonth(filters.availableTo, locale)}`
      : null;

  /**
   * What the guest actually searched for, in one line.
   *
   * Every platform's Search event takes a single search term, and the URL is
   * the search: a destination, a date range and a guest count. Assembled from
   * the parsed filters rather than the raw query string so a bookmarked link
   * with junk parameters reports what was honoured, not what was typed.
   */
  const searchTerm = [
    listingType ? label(listingType, locale) : null,
    filters.city && filters.city !== "all" ? cityLabel(filters.city, locale) : null,
    filters.q || null,
    dateLine,
    filters.minCapacity ? `${filters.minCapacity}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  /**
   * One distinct search, once per tab.
   *
   * Without a key this page reports a Search on every mount — and a guest who
   * opens five rest houses from one result page and presses back each time
   * mounts it six times. Meta and TikTok both size audiences off Search volume,
   * so that is a fivefold lie about the top of the funnel.
   *
   * The key is what was actually searched for, so changing a filter is a new
   * search and the back button is not. `sort` is deliberately excluded:
   * re-ordering the same results is not a new question. Amenities are included
   * even though they are not in the readable `searchTerm` — narrowing to "has a
   * pool" IS a different search, and leaving them out would swallow it.
   */
  const searchKey = [
    filters.city ?? "",
    filters.type ?? "",
    filters.q ?? "",
    filters.availableFrom ?? "",
    filters.availableTo ?? "",
    filters.minCapacity ?? "",
    [...(filters.amenities ?? [])].sort().join(","),
  ].join("|");

  return (
    <div className="min-h-[70vh] bg-sand-50">
      {/* The plan's Search. Fired from the results page rather than from the
          hero bar, the filters panel and the sort menu in turn: every one of
          those ends here, and the count is only known once the results are in.
          Filters are in the URL, so this re-fires when they change — which is
          what a search is. */}
      <TrackEvent
        event="Search"
        dedupeKey={searchKey}
        payload={{ query: searchTerm, count: listings.length }}
      />

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
                  // The dates and guest count searched for ride along into the
                  // rest house's page, so its calendar opens on them.
                  linkQuery={stayQuery(filters)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
